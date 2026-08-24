import { MAX_PROBE_ATTEMPTS, PROBE_TIMEOUT_MS } from '../src/constants';

describe('429 探测恢复常量', () => {
  it('MAX_PROBE_ATTEMPTS 应为 10', () => {
    expect(MAX_PROBE_ATTEMPTS).toBe(10);
  });

  it('PROBE_TIMEOUT_MS 应为 30000（30 秒）', () => {
    expect(PROBE_TIMEOUT_MS).toBe(30000);
  });
});
