import { expect, it } from 'vitest';
import { ApiError } from '../api';
import { errorText } from './workspace-helpers';

it('AT-15 C3 translates server error codes in the requested interface language', () => {
  const error = new ApiError('RATE_LIMITED', 'Rate limit exceeded from the API', 429);
  expect(errorText(error, '请重试。', 'zh-CN')).toBe('尝试次数过多，请稍后再试。');
  expect(errorText(error, 'Retry.', 'en')).toBe('Too many attempts. Try again later.');
});
it('AT-15 C3 uses a local fallback for unknown server codes and network errors', () => {
  expect(
    errorText(new ApiError('NEW_SERVER_ERROR', 'Untranslated server message', 500), '暂时无法完成请求。', 'zh-CN'),
  ).toBe('暂时无法完成请求。');
  expect(errorText(new TypeError('Failed to fetch'), '请检查连接。', 'zh-CN')).toBe('请检查连接。');
});
