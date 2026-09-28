// 一次性脚本:把本地 data.json 迁移到 Vercel KV
// 用法:
//   1. 在 Vercel 创建好 KV 数据库,把 KV_REST_API_URL / KV_REST_API_TOKEN 复制到 .env
//   2. npm install
//   3. node migrate-to-kv.js
const fs = require('fs');
const path = require('path');

// 自动读 .env 文件(避免装 dotenv)
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  }
} catch (e) {}

if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
  console.error('❌ 缺少 KV_REST_API_URL / KV_REST_API_TOKEN 环境变量');
  console.error('   请在 .env 文件填好 Vercel KV 的连接信息后再运行');
  process.exit(1);
}

const { kv } = require('@vercel/kv');
const DATA_FILE = path.join(__dirname, 'data.json');

(async () => {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('❌ 本地 data.json 不存在,无数据可迁移');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log('📦 即将迁移:');
  console.log('   - 商品:', (data.goods || []).length, '条');
  console.log('   - 订单:', (data.orders || []).length, '条');
  console.log('   - 收款码:', Object.keys(data.qrs || {}).join(',') || '无');

  await Promise.all([
    kv.set('goods', data.goods || []),
    kv.set('qrs', data.qrs || {}),
    kv.set('orders', data.orders || [])
  ]);
  console.log('✅ 迁移完成!现在 Vercel 部署后数据就在 KV 里了');
})().catch(e => {
  console.error('❌ 迁移失败:', e.message);
  process.exit(1);
});
