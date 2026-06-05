import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  requestOtp,
  verifyOtp,
  goOnline,
  listOffers,
  claimDelivery,
  updateLocation,
  ApiError,
} from './api';

afterEach(() => vi.unstubAllGlobals());

// Stub global fetch to return a response, and capture the call args (typed params
// so `mock.calls[0]` is a [url, init] tuple). A fresh Response per stub, since a
// body can only be read once.
function stubFetch(status: number, body?: unknown) {
  const res =
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const mock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(res));
  vi.stubGlobal('fetch', mock);
  return mock;
}

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe('api client', () => {
  it('requestOtp POSTs the phone with no Authorization header', async () => {
    const mock = stubFetch(202, { status: 'otp_sent' });
    expect(await requestOtp('+263772749678')).toEqual({ status: 'otp_sent' });

    const [url, init] = mock.mock.calls[0];
    expect(url).toContain('/v1/driver/auth/request-otp');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ phone: '+263772749678' });
    expect(headersOf(init).Authorization).toBeUndefined();
  });

  it('verifyOtp returns the token + driver_id', async () => {
    stubFetch(200, { token: 'udr_live_x', driver_id: 'd1' });
    expect(await verifyOtp('+1', '123456')).toEqual({ token: 'udr_live_x', driver_id: 'd1' });
  });

  it('authenticated calls attach the Bearer token + body', async () => {
    const mock = stubFetch(200, { status: 'available' });
    await goOnline('tok123', { lat: -17.8, lng: 31 });

    const init = mock.mock.calls[0][1];
    expect(headersOf(init).Authorization).toBe('Bearer tok123');
    expect(JSON.parse(init.body as string)).toEqual({ lat: -17.8, lng: 31 });
  });

  it('listOffers GETs with auth', async () => {
    const mock = stubFetch(200, { data: [] });
    expect(await listOffers('t')).toEqual({ data: [] });
    expect(mock.mock.calls[0][1].method).toBe('GET');
  });

  it('throws ApiError carrying the status on a non-2xx', async () => {
    stubFetch(409, { error: 'taken' });
    await expect(claimDelivery('t', 'id')).rejects.toBeInstanceOf(ApiError);
    stubFetch(409, { error: 'taken' });
    await expect(claimDelivery('t', 'id')).rejects.toMatchObject({ status: 409 });
  });

  it('treats 204 No Content as void (location ping)', async () => {
    stubFetch(204);
    await expect(updateLocation('t', 1, 2)).resolves.toBeUndefined();
  });
});
