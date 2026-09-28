const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PWD = process.env.ADMIN_PWD || '200212';
// Render 部署会清空代码目录,但免费层没法挂持久磁盘
// 把 data.json 放到 /tmp 或 __dirname,重启会丢;若升 Starter 可挂磁盘到 /data
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : __dirname);
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// 默认数据(首次启动初始化)
const DEFAULT_GOODS = [
  {id:1, name:"Notion 极简生活模板", desc:"自用整理的 Notion 模板,含日程/记账/读书追踪。", price:9.9, emoji:"📓", tag:"数字模板", deliveryUrl:""},
  {id:2, name:"《STM32 入坑笔记》PDF", desc:"个人寄存器级开发整理,含 UART/SPI 例子,60 页。", price:19.9, emoji:"📘", tag:"电子书", deliveryUrl:""},
  {id:3, name:"ESP-IDF 视频教程网盘", desc:"32 集 esp32c3 入门到 DHT11/HTTP,百度网盘链接。", price:29.9, emoji:"🎥", tag:"教程", deliveryUrl:""},
  {id:4, name:"ChatGPT 共享车位(30天)", desc:"个人车位一个,可走 GPT-4o,30 天到期,一人独享。", price:15, emoji:"🚗", tag:"账号", deliveryUrl:""},
  {id:5, name:"Midjourney 提示词合集", desc:"500+ 精修提示词,风景/人物/Logo,含效果预览。", price:6.6, emoji:"🎨", tag:"素材", deliveryUrl:""},
  {id:6, name:"Python 爬虫小工具源码", desc:"搜索引擎+网盘源码,带 GUI 界面,即下即用。", price:12.9, emoji:"🐍", tag:"源码", deliveryUrl:""},
];

function loadData(){
  try{
    if(!fs.existsSync(DATA_FILE)) return {goods:DEFAULT_GOODS.slice(), qrs:{}, orders:[]};
    return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
  }catch(e){ return {goods:DEFAULT_GOODS.slice(), qrs:{}, orders:[]}; }
}
function saveData(d){
  try{ fs.writeFileSync(DATA_FILE, JSON.stringify(d,null,2)); }
  catch(e){ console.error('save data fail',e); }
}

app.use(express.json({limit:'5mb'}));
app.use(express.static(__dirname, {index:'index.html'}));

// 鉴权中间件
function auth(req,res,next){
  if(req.headers['x-admin-pwd']===ADMIN_PWD) return next();
  res.status(401).json({error:'unauthorized'});
}

// ---- 商品 ----
app.get('/api/goods', (req,res)=> res.json(loadData().goods) );

app.post('/api/goods', auth, (req,res)=>{
  const {name,desc,price,emoji,tag,deliveryUrl,image,images}=req.body||{};
  if(!name||!desc||!(price>=0)) return res.status(400).json({error:'missing fields'});
  const d=loadData();
  // 兼容旧版单张 image 字段:合并到 images 数组,去重去空
  let imgs=Array.isArray(images)?images.filter(Boolean):[];
  if(image && !imgs.length) imgs=[image];
  const g={id:Date.now(),name,desc,price:Number(price),emoji:emoji||'📦',tag:tag||'其他',deliveryUrl:deliveryUrl||'',images:imgs};
  d.goods.push(g); saveData(d);
  res.json(g);
});

app.delete('/api/goods/:id', auth, (req,res)=>{
  const id=Number(req.params.id);
  const d=loadData();
  d.goods=d.goods.filter(g=>g.id!==id); saveData(d);
  res.json({ok:true});
});

app.post('/api/goods/reset', auth, (req,res)=>{
  const d=loadData(); d.goods=DEFAULT_GOODS.slice(); saveData(d);
  res.json({ok:true});
});

// ---- 二维码 ----
app.get('/api/qr', (req,res)=> res.json(loadData().qrs||{}) );

app.post('/api/qr', auth, (req,res)=>{
  const {type,data}=req.body||{};
  if(!['alipay','wechat'].includes(type) || !data) return res.status(400).json({error:'bad'});
  const d=loadData(); d.qrs=d.qrs||{}; d.qrs[type]=data; saveData(d);
  res.json({ok:true});
});

// ---- 订单 ----
app.get('/api/orders', auth, (req,res)=> res.json(loadData().orders||[]) );

// 访客按订单号列表查自己的订单(本机 localStorage 存的订单号,无鉴权)
app.get('/api/orders/by-ids', (req,res)=>{
  const ids=String(req.query.ids||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!ids.length) return res.json([]);
  const d=loadData(); d.orders=d.orders||[];
  res.json(d.orders.filter(o=>ids.includes(o.id)));
});

app.post('/api/orders', (req,res)=>{
  const {goodsId,qty,remark,pay}=req.body||{};
  const d=loadData();
  const g=d.goods.find(x=>x.id===Number(goodsId));
  if(!g) return res.status(400).json({error:'goods not found'});
  const q=Math.max(1,Number(qty)||1);
  const o={
    id:String(Date.now()).slice(-8),
    goodsId:g.id, goods:g.name, qty:q,
    total:Number((g.price*q).toFixed(2)),
    pay:pay||'',                       // '支付宝' / '微信'
    remark:remark||'',                 // 访客留言(可填微信号等联系方式)
    deliveryUrl:g.deliveryUrl||'',     // 商品发货链接快照,管理员确认付款后展示
    status:'wait',                      // wait 待付款 / reported 待核实 / paid 已核实 / sent 已发货 / done 已完成
    payer:'',                           // 访客填的付款人名称/转账单号,便于管理员对账核实
    time:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})
  };
  d.orders=d.orders||[]; d.orders.unshift(o); saveData(d);
  res.json(o);
});

// 访客上报已付款(无鉴权):接 {payer: 付款人名称/转账单号},把 wait 改 reported,等管理员对账核实
app.post('/api/orders/:id/report', (req,res)=>{
  const id=req.params.id; const {payer}=req.body||{};
  const d=loadData(); d.orders=d.orders||[];
  const o=d.orders.find(x=>x.id===id);
  if(!o) return res.status(404).json({error:'not found'});
  if(o.status!=='wait') return res.status(400).json({error:'订单状态不允许提交,当前:'+o.status});
  o.status='reported'; o.payer=String(payer||'').trim(); saveData(d);
  res.json(o);
});

app.post('/api/orders/:id/status', auth, (req,res)=>{
  const id=req.params.id; const {status}=req.body||{};
  if(!['wait','reported','paid','sent','done'].includes(status)) return res.status(400).json({error:'bad status'});
  const d=loadData(); d.orders=d.orders||[];
  const o=d.orders.find(x=>x.id===id);
  if(!o) return res.status(404).json({error:'not found'});
  o.status=status; saveData(d);
  res.json(o);
});

app.delete('/api/orders/:id', auth, (req,res)=>{
  const id=req.params.id;
  const d=loadData(); d.orders=d.orders||[];
  d.orders=d.orders.filter(x=>x.id!==id); saveData(d);
  res.json({ok:true});
});

app.listen(PORT, ()=>console.log('server on http://localhost:'+PORT));
