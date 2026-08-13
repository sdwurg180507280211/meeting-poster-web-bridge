#target photoshop
app.displayDialogs = DialogModes.NO;
app.preferences.rulerUnits = Units.PIXELS;
app.preferences.typeUnits = TypeUnits.PIXELS;

var psdPath = '/Users/edy/Desktop/baiduwangpan/其它/审核/20260804-海报/会议海报模板.psd';
var outPath = '/tmp/psd-fonts-dump.json';

function jsStr(s) {
  s = String(s);
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}
function ser(v) {
  if (v === null || v === undefined) return 'null';
  var t = typeof v;
  if (t === 'number' || t === 'boolean') return String(v);
  if (t === 'string') return jsStr(v);
  if (v instanceof Array) {
    var a = [];
    for (var i = 0; i < v.length; i++) a.push(ser(v[i]));
    return '[' + a.join(',') + ']';
  }
  var k = [];
  for (var key in v) {
    if (Object.prototype.hasOwnProperty.call(v, key)) k.push(jsStr(key) + ':' + ser(v[key]));
  }
  return '{' + k.join(',') + '}';
}

function tryGet(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

var result = { error: null, doc: null, layers: [], texts: [] };

try {
  var doc = app.open(new File(psdPath));
  result.doc = {
    name: String(doc.name),
    width: doc.width.value,
    height: doc.height.value,
    resolution: doc.resolution
  };

  function walk(ls, parent) {
    for (var i = 0; i < ls.length; i++) {
      var l = ls[i];
      var info = {
        name: String(l.name),
        type: String(l.typename),
        kind: (l.typename === 'ArtLayer') ? String(l.kind) : null,
        visible: Boolean(l.visible),
        parent: parent,
        bounds: null
      };
      info.bounds = tryGet(function () {
        var b = l.bounds;
        return [b[0].value, b[1].value, b[2].value, b[3].value];
      }, null);

      if (l.typename === 'ArtLayer' && String(l.kind) === 'LayerKind.TEXT') {
        var t = {
          font: tryGet(function () { return String(l.textItem.font); }, null),
          sizeRaw: tryGet(function () { return String(l.textItem.size); }, null),
          sizePx: tryGet(function () { return parseFloat(l.textItem.size); }, null),
          color: tryGet(function () { return String(l.textItem.color.rgb.hexValue); }, null),
          tracking: tryGet(function () { return String(l.textItem.tracking); }, null),
          leading: tryGet(function () { return String(l.textItem.leading); }, null),
          autoLeading: tryGet(function () { return String(l.textItem.autoLeading); }, null),
          justification: tryGet(function () { return String(l.textItem.justification); }, null),
          position: tryGet(function () {
            var p = l.textItem.position;
            return [p[0].value, p[1].value];
          }, null),
          contents: tryGet(function () { return String(l.textItem.contents); }, null),
          fontPostScriptName: tryGet(function () { return String(l.textItem.fontPostScriptName); }, null)
        };
        info.text = t;
        result.texts.push(info);
      }

      result.layers.push(info);
      if (l.typename === 'LayerSet') {
        walk(l.layers, String(l.name));
      }
    }
  }

  walk(doc.layers, 'ROOT');

  var out = new File(outPath);
  out.encoding = 'UTF-8';
  out.open('w');
  out.write(ser(result));
  out.close();

  doc.close(SaveOptions.DONOTSAVECHANGES);
  $._response = 'WROTE layers=' + result.layers.length + ' texts=' + result.texts.length;
} catch (e) {
  result.error = String(e);
  try {
    var out2 = new File(outPath);
    out2.encoding = 'UTF-8';
    out2.open('w');
    out2.write(ser(result));
    out2.close();
  } catch (e2) {}
  $._response = 'ERROR ' + String(e);
}
