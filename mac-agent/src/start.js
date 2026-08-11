'use strict';

const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(agentRoot, '.env') });

// 生产默认不保留已处理任务，避免 inbox/outbox 长期累积。
// 如需本地排查，可显式在 .env 设置 KEEP_LOCAL_JOBS=true。
if (process.env.KEEP_LOCAL_JOBS == null || process.env.KEEP_LOCAL_JOBS === '') {
  process.env.KEEP_LOCAL_JOBS = 'false';
}

require('./agent');
