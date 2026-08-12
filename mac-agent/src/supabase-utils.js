'use strict';

function formatSupabaseError(error) {
  if (!error) return '未知 Supabase 错误';
  const parts = [error.code, error.message, error.details, error.hint]
    .filter((value) => value != null && String(value).trim())
    .map((value) => String(value).trim());
  return parts.join(' · ').slice(0, 1500) || String(error).slice(0, 1500);
}

function checkedResult(result, context, { requireData = false } = {}) {
  if (!result || typeof result !== 'object') throw new Error(`${context} 未返回有效响应`);
  if (result.error) {
    const error = new Error(`${context}失败：${formatSupabaseError(result.error)}`);
    error.code = result.error.code || result.error.statusCode || 'SUPABASE_ERROR';
    error.supabaseError = result.error;
    throw error;
  }
  if (requireData && result.data == null) throw new Error(`${context}失败：目标任务不存在或状态已变化`);
  return result.data;
}

function boundedErrorMessage(error, prefix = '', maxLength = 1200) {
  const raw = error && error.message ? error.message : String(error || '未知错误');
  const normalized = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
  return `${prefix}${normalized}`.slice(0, maxLength);
}

module.exports = { boundedErrorMessage, checkedResult, formatSupabaseError };
