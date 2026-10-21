(function () {
  var missing = [];
  ['fetch', 'ReadableStream', 'TextDecoder', 'AbortController', 'URL', 'URLSearchParams', 'Promise', 'Headers', 'Response', 'Intl'].forEach(function (name) {
    if (typeof window[name] === 'undefined') missing.push(name);
  });
  if (window.Intl && typeof Intl.DateTimeFormat.prototype.formatToParts !== 'function') missing.push('Intl.formatToParts');
  if (typeof Object.fromEntries !== 'function') missing.push('Object.fromEntries');
  function show(text) {
    var node = document.getElementById('boot-status');
    if (node) node.textContent = text;
  }
  if (missing.length) show('WebView 不支持 / Unsupported: ' + missing.join(', '));
  window.addEventListener('error', function () { show(missing.length ? 'WebView 不支持 / Unsupported: ' + missing.join(', ') : 'WebView 启动失败，请记录系统与 WebView 版本。 / WebView startup failed.'); });
}());
