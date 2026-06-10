import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  requestOtp,
  verifyOtp,
  goOnline,
  listOffers,
  claimDelivery,
  updateLocation,
  ApiError,
  setUnauthorizedHandler,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

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

  // Regression: a bodyless POST must NOT send Content-Type: application/json, or RN's
  // Android fetch + the server body-parser produce a 400 before the handler runs
  // (this broke claim + every lifecycle transition on-device).
  it('omits Content-Type on a bodyless POST (claim)', async () => {
    const mock = stubFetch(200, { id: 'd1', status: 'assigned' });
    await claimDelivery('tok', 'd1');
    const init = mock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headersOf(init)['Content-Type']).toBeUndefined();
    expect(headersOf(init).Authorization).toBe('Bearer tok');
  });

  it('sets Content-Type only when there is a body (goOnline)', async () => {
    const mock = stubFetch(200, { status: 'available' });
    await goOnline('tok', { lat: 1, lng: 2 });
    expect(headersOf(mock.mock.calls[0][1])['Content-Type']).toBe('application/json');
  });

  it('markFailed sends the reason as a JSON body, and stays bodyless without one', async () => {
    const { markFailed } = await import('./api');
    let mock = stubFetch(200, { id: 'd1', status: 'failed' });
    await markFailed('tok', 'd1', 'customer_unreachable');
    let init = mock.mock.calls[0][1];
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'customer_unreachable' });
    expect(headersOf(init)['Content-Type']).toBe('application/json');

    mock = stubFetch(200, { id: 'd1', status: 'failed' });
    await markFailed('tok', 'd1');
    init = mock.mock.calls[0][1];
    expect(init.body).toBeUndefined(); // the RN-Android bodyless-POST fix must hold
    expect(headersOf(init)['Content-Type']).toBeUndefined();
  });

  it('markDelivered carries the COD amount + note', async () => {
    const { markDelivered } = await import('./api');
    const mock = stubFetch(200, { id: 'd1', status: 'delivered' });
    await markDelivered('tok', 'd1', { method: 'manual', note: 'gate guard', cod_collected_minor: 7500 });
    expect(JSON.parse(mock.mock.calls[0][1].body as string)).toEqual({
      method: 'manual',
      note: 'gate guard',
      cod_collected_minor: 7500,
    });
  });

  it('getEarnings GETs with auth; push token registers and removes', async () => {
    const { getEarnings, registerPushToken, removePushToken } = await import('./api');
    let mock = stubFetch(200, { payable_minor: 160, today_minor: 160, today_deliveries: 1, cod_owed_minor: 0, currency: 'USD' });
    const e = await getEarnings('tok');
    expect(e.payable_minor).toBe(160);
    expect(mock.mock.calls[0][0]).toContain('/v1/driver/earnings');

    mock = stubFetch(204);
    await registerPushToken('tok', 'ExponentPushToken[x]', 'android');
    expect(mock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(mock.mock.calls[0][1].body as string)).toEqual({ token: 'ExponentPushToken[x]', platform: 'android' });

    mock = stubFetch(204);
    await removePushToken('tok', 'ExponentPushToken[x]');
    expect(mock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('declineOffer is a bodyless POST (no Content-Type — the RN-Android fix must hold)', async () => {
    const { declineOffer } = await import('./api');
    const mock = stubFetch(204);
    await declineOffer('tok', 'd1');
    const [url, init] = mock.mock.calls[0];
    expect(url).toContain('/v1/driver/offers/d1/decline');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(headersOf(init)['Content-Type']).toBeUndefined();
  });

  it('updateProfile PATCHes only the driver-editable fields; history GETs with auth', async () => {
    const { updateProfile, listMyDeliveries } = await import('./api');
    let mock = stubFetch(204);
    await updateProfile('tok', { name: 'Tendai M.', vehicle: 'Honda Fit' });
    expect(mock.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(mock.mock.calls[0][1].body as string)).toEqual({ name: 'Tendai M.', vehicle: 'Honda Fit' });

    mock = stubFetch(200, { data: [{ id: 'd1', status: 'delivered', driver_fee_minor: 160 }] });
    const h = await listMyDeliveries('tok');
    expect(h.data[0].driver_fee_minor).toBe(160);
    expect(mock.mock.calls[0][0]).toContain('/v1/driver/deliveries');
    expect(headersOf(mock.mock.calls[0][1]).Authorization).toBe('Bearer tok');
  });

  it('fires the unauthorized handler on an authenticated 401, not a pre-auth 401', async () => {
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);

    // authenticated call (has token) → 401 → global sign-out fires
    stubFetch(401, { error: 'unauthorized' });
    await expect(claimDelivery('tok', 'd1')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalledTimes(1);

    // pre-auth call (no token), e.g. a wrong OTP at login → must NOT log anyone out
    stubFetch(401, { error: 'bad code' });
    await expect(verifyOtp('+263772749678', '000000')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });
});
