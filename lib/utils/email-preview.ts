export function getEditablePreviewHtml(html: string): string {
  if (!html) return '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; outline: none; }
    .rc-hover-toolbar {
      position: absolute;
      background: rgba(12,24,41,0.95);
      color: white;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 9999;
      display: none;
      pointer-events: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      max-width: 90%;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .rc-hover-toolbar span { font-weight: 600; white-space: nowrap; }
    .rc-hover-toolbar input {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      font-size: 12px;
      width: 300px;
      max-width: 55vw;
      padding: 3px 8px;
      border-radius: 4px;
      outline: none;
      font-family: monospace;
    }
    .rc-hover-toolbar input:focus {
      border-color: #c6923a;
      background: rgba(255,255,255,0.15);
    }
  </style>
</head>
<body contenteditable="true">
  ${html}
  <script>
    (function() {
      document.addEventListener('click', function(e) {
        var anchor = e.target.closest('a');
        if (anchor) { e.preventDefault(); e.stopPropagation(); }
      }, true);
      document.addEventListener('auxclick', function(e) {
        if (e.target.closest('a')) e.preventDefault();
      }, true);
      var clickables = document.querySelectorAll('a[href], button[data-href]');
      clickables.forEach(function(el) {
        var toolbar = document.createElement('div');
        toolbar.className = 'rc-hover-toolbar';
        var label = document.createElement('span');
        label.textContent = el.tagName === 'BUTTON' ? 'Action URL: ' : 'URL: ';
        var input = document.createElement('input');
        input.type = 'text';
        input.value = el.getAttribute('href') || el.getAttribute('data-href') || '';
        input.placeholder = 'https://...';
        input.addEventListener('keydown', function(e) { e.stopPropagation(); });
        input.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        toolbar.appendChild(label);
        toolbar.appendChild(input);
        document.body.appendChild(toolbar);
        function showToolbar() {
          var rect = el.getBoundingClientRect();
          toolbar.style.top = (window.scrollY + rect.bottom + 5) + 'px';
          toolbar.style.left = Math.max(4, window.scrollX + rect.left) + 'px';
          toolbar.style.display = 'flex';
          el.style.outline = '2px dashed #c6923a';
          el.style.outlineOffset = '2px';
        }
        function hideToolbar() {
          setTimeout(function() {
            if (!toolbar.matches(':hover') && !el.matches(':hover')) {
              toolbar.style.display = 'none';
              el.style.outline = 'none';
            }
          }, 250);
        }
        el.addEventListener('mouseenter', showToolbar);
        el.addEventListener('mouseleave', hideToolbar);
        toolbar.addEventListener('mouseleave', hideToolbar);
        input.addEventListener('input', function(e) {
          el.setAttribute('href', e.target.value);
        });
      });
    })();
  </script>
</body>
</html>`;
}