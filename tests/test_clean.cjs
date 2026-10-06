const assert = require('node:assert/strict');
const { cleanBook } = require('../browser_extension/clean.js');
const examples = [
  [{title:'局外人（译文经典）', author:'加缪'}, {title:'局外人',author:'加缪'}],
  [{title:'荒原狼（译文经典（精装本））',author:'赫尔曼·黑塞 著, 赵登荣 译, 倪诚恩 译'}, {title:'荒原狼',author:'赫尔曼·黑塞'}],
  [{title:'动物农场【上海译文出品 豆瓣高分推荐】 (译文经典)',author:'乔治·奥威尔(George Orwell),董乐山 译'}, {title:'动物农场',author:'乔治·奥威尔(George Orwell)'}],
  [{title:'人文主义地理学:对于意义的个体追寻 (译文经典)',author:'段义孚(Yi-Fu Tuan)'}, {title:'人文主义地理学:对于意义的个体追寻',author:'段义孚(Yi-Fu Tuan)'}],
  [{title:'作品（69）',author:'张译, 张三'}, {title:'作品（69）',author:'张译、张三'}],
  [{title:'标题【没有闭合',author:'不认识的人'}, {title:'标题【没有闭合',author:'不认识的人'}],
  [{title:'[译文经典]爱情笔记',author:'[日] 吉本芭娜娜 (吉本ばなな) 著 ; 李萍 译'}, {title:'爱情笔记',author:'吉本芭娜娜 (吉本ばなな)'}],
  [{title:'作品',author:'托马斯·曼(Thomas Mann, Jr.)'}, {title:'作品',author:'托马斯·曼(Thomas Mann, Jr.)'}],
  [{title:'作品',author:'张三 译'}, {title:'作品',author:'张三 译'}],
  [{title:'作品',author:'R.M.里尔克(R.M.Rilke) [R.M.里尔克(R.M.Rilke)]'}, {title:'作品',author:'R.M.里尔克(R.M.Rilke)'}],
  [{title:'作品',author:'萨特, 杜小真 (译)'}, {title:'作品',author:'萨特'}],
];
for (const [input, expected] of examples) {
  const original = {...input};
  assert.deepEqual(cleanBook(input), expected);
  assert.deepEqual(input, original, '原始数据不能被修改');
  assert.deepEqual(cleanBook(expected), expected, '重复清洗应保持结果一致');
}
console.log(`${examples.length} 个清洗/保留案例通过；原文不变，重复清洗一致`);
