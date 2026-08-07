import { describe, expect, it } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import {
  isSensitiveKey,
  scrubBeforeBreadcrumb,
  scrubBeforeSend,
  scrubData,
  scrubEvent,
  scrubString,
} from './scrub';
import { DEFAULT_TRACES_SAMPLE_RATE, parseSampleRate } from './sample-rate';

describe('scrubString', () => {
  it('redacts a bearer token', () => {
    expect(scrubString('401 /driver/offers — Bearer abc.DEF-123_xyz+/=')).toBe(
      '401 /driver/offers — Bearer [redacted]',
    );
  });

  it('redacts Zimbabwe mobile numbers in every accepted shape', () => {
    expect(scrubString('call +263771234567')).toBe('call [phone]');
    expect(scrubString('call 263771234567')).toBe('call [phone]');
    expect(scrubString('call 0771234567')).toBe('call [phone]');
  });

  it('redacts other E.164 numbers', () => {
    expect(scrubString('support +447700900123')).toBe('support [phone]');
  });

  it('redacts a coordinate pair but leaves money and distances alone', () => {
    expect(scrubString('fix -17.82525,31.03351 stale')).toBe('fix [coords] stale');
    expect(scrubString('fix -17.82525, 31.03351')).toBe('fix [coords]');
    expect(scrubString('fare 12.50, distance 3.20 km')).toBe('fare 12.50, distance 3.20 km');
  });

  it('strips the query string off a presigned upload URL but keeps the path', () => {
    const msg =
      'PUT https://r2.example.com/pod/abc.jpg?X-Amz-Signature=deadbeefcafe&X-Amz-Expires=900 failed';
    expect(scrubString(msg)).toBe('PUT https://r2.example.com/pod/abc.jpg?[redacted] failed');
  });

  it('leaves a query-less API URL untouched', () => {
    const msg = 'GET https://urafro-next.fly.dev/v1/driver/offers failed';
    expect(scrubString(msg)).toBe(msg);
  });

  it('redacts an Expo push token', () => {
    expect(scrubString('token ExponentPushToken[xxxxxxxx] registered')).toBe(
      'token [push-token] registered',
    );
  });

  it('leaves an ordinary error message alone', () => {
    const msg = '409 /driver/deliveries/2f1c/claim — already assigned';
    expect(scrubString(msg)).toBe(msg);
  });
});

describe('isSensitiveKey', () => {
  it('matches the PII-carrying keys this app actually holds', () => {
    for (const k of [
      'phone',
      'dropoff_contact',
      'pickup_address',
      'landmark',
      'podPin',
      'pod_pin',
      'lat',
      'lng',
      'latitude',
      'note',
      'code',
      'pin',
      'plate',
      'account_ref',
      'holder_name',
      'Authorization',
      'expoPushToken',
      'emergency_contact_phone',
    ]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
  });

  it('leaves the fields that make an error debuggable', () => {
    for (const k of [
      'status_code',
      'method',
      'url',
      'delivery_id',
      'attempts',
      'action',
      'spinner',
      'versionCode',
      'model',
    ]) {
      expect(isSensitiveKey(k), k).toBe(false);
    }
  });
});

describe('scrubData', () => {
  it('redacts by key and pattern-scrubs the surviving strings', () => {
    expect(
      scrubData({
        deliveryId: 'd_123',
        dropoff_contact: { name: 'Tapiwa', phone: '+263771234567' },
        lat: -17.82525,
        lng: 31.03351,
        detail: 'ring 0771234567 on arrival',
      }),
    ).toEqual({
      deliveryId: 'd_123',
      dropoff_contact: '[redacted]',
      lat: '[redacted]',
      lng: '[redacted]',
      detail: 'ring [phone] on arrival',
    });
  });

  it('walks arrays', () => {
    expect(scrubData([{ phone: '0771234567' }, { status_code: 500 }])).toEqual([
      { phone: '[redacted]' },
      { status_code: 500 },
    ]);
  });

  it('stops at the depth limit', () => {
    let deep: Record<string, unknown> = { leaf: 'ok' };
    for (let i = 0; i < 12; i += 1) deep = { nest: deep };
    expect(JSON.stringify(scrubData(deep))).toContain('[redacted]');
  });

  it('survives a cycle without hanging', () => {
    const a: Record<string, unknown> = { id: 'a' };
    a.self = a;
    expect(scrubData(a)).toEqual({ id: 'a', self: '[redacted]' });
  });

  it('does not over-redact a reference shared between siblings', () => {
    const shared = { status_code: 500 };
    expect(scrubData({ first: shared, second: shared })).toEqual({
      first: { status_code: 500 },
      second: { status_code: 500 },
    });
  });
});

describe('scrubEvent', () => {
  it('scrubs the message, the exception value, breadcrumbs and extra', () => {
    const event = {
      message: 'failed for 0771234567',
      exception: { values: [{ value: 'POST /driver/location — Bearer secrettoken' }] },
      breadcrumbs: [
        { message: 'fix -17.82525,31.03351' },
        { data: { url: 'https://r2.example.com/pod/a.jpg?X-Amz-Signature=abc', status_code: 500 } },
      ],
      extra: { podPin: '4821', deliveryId: 'd_9' },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);

    expect(out.message).toBe('failed for [phone]');
    expect(out.exception?.values?.[0]?.value).toBe('POST /driver/location — Bearer [redacted]');
    expect(out.breadcrumbs?.[0]?.message).toBe('fix [coords]');
    expect(out.breadcrumbs?.[1]?.data).toEqual({
      url: 'https://r2.example.com/pod/a.jpg?[redacted]',
      status_code: 500,
    });
    expect(out.extra).toEqual({ podPin: '[redacted]', deliveryId: 'd_9' });
  });

  it('drops the device name but keeps the model', () => {
    const event = {
      contexts: { device: { name: "Tapiwa's A03", model: 'SM-A035F' } },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);

    expect(out.contexts?.device?.name).toBeUndefined();
    expect(out.contexts?.device?.model).toBe('SM-A035F');
  });

  it('keeps only the installation id on the user object', () => {
    const withUser = {
      user: { id: 'install-1', ip_address: '10.0.0.1', email: 'driver@example.com' },
    } as unknown as ErrorEvent;
    expect(scrubEvent(withUser).user).toEqual({ id: 'install-1' });

    const withoutId = { user: { ip_address: '10.0.0.1' } } as unknown as ErrorEvent;
    expect(scrubEvent(withoutId).user).toBeUndefined();
  });
});

describe('the Sentry hooks fail closed', () => {
  it('drops an event whose scrub throws rather than sending it un-scrubbed', () => {
    const hostile = {
      get message(): string {
        throw new Error('boom');
      },
    } as unknown as ErrorEvent;
    expect(scrubBeforeSend(hostile)).toBeNull();
  });

  it('drops a breadcrumb whose scrub throws', () => {
    const hostile = {
      get message(): string {
        throw new Error('boom');
      },
    } as unknown as Breadcrumb;
    expect(scrubBeforeBreadcrumb(hostile)).toBeNull();
  });

  it('passes a well-formed event and breadcrumb through', () => {
    expect(scrubBeforeSend({ message: 'plain' } as ErrorEvent)?.message).toBe('plain');
    expect(scrubBeforeBreadcrumb({ message: 'plain' })?.message).toBe('plain');
  });
});

describe('parseSampleRate', () => {
  it('defaults to zero when unset, blank or malformed', () => {
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBe(0);
    expect(parseSampleRate(undefined)).toBe(0);
    expect(parseSampleRate('')).toBe(0);
    expect(parseSampleRate('   ')).toBe(0);
    expect(parseSampleRate('10%')).toBe(0);
    expect(parseSampleRate('0,5')).toBe(0);
  });

  it('accepts a written rate and clamps it into 0..1', () => {
    expect(parseSampleRate('0.25')).toBe(0.25);
    expect(parseSampleRate(' 1 ')).toBe(1);
    expect(parseSampleRate('5')).toBe(1);
    expect(parseSampleRate('-1')).toBe(0);
  });

  it('never accepts a prefix of a typo', () => {
    expect(parseSampleRate('0.5oops')).toBe(0);
  });
});
