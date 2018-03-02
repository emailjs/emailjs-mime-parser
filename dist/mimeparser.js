'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = parse;

var _node = require('./node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function parse(chunk) {
  var root = new _node2.default();
  var lines = ((typeof chunk === 'undefined' ? 'undefined' : _typeof(chunk)) === 'object' ? String.fromCharCode.apply(null, chunk) : chunk).split(/\r?\n/g);
  lines.forEach(function (line) {
    return root.writeLine(line);
  });
  root.finalize();
  return root;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9taW1lcGFyc2VyLmpzIl0sIm5hbWVzIjpbInBhcnNlIiwiY2h1bmsiLCJyb290IiwibGluZXMiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJhcHBseSIsInNwbGl0IiwiZm9yRWFjaCIsIndyaXRlTGluZSIsImxpbmUiLCJmaW5hbGl6ZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7a0JBRXdCQSxLOztBQUZ4Qjs7Ozs7O0FBRWUsU0FBU0EsS0FBVCxDQUFnQkMsS0FBaEIsRUFBdUI7QUFDcEMsTUFBTUMsT0FBTyxvQkFBYjtBQUNBLE1BQU1DLFFBQVEsQ0FBQyxRQUFPRixLQUFQLHlDQUFPQSxLQUFQLE9BQWlCLFFBQWpCLEdBQTRCRyxPQUFPQyxZQUFQLENBQW9CQyxLQUFwQixDQUEwQixJQUExQixFQUFnQ0wsS0FBaEMsQ0FBNUIsR0FBcUVBLEtBQXRFLEVBQTZFTSxLQUE3RSxDQUFtRixRQUFuRixDQUFkO0FBQ0FKLFFBQU1LLE9BQU4sQ0FBYztBQUFBLFdBQVFOLEtBQUtPLFNBQUwsQ0FBZUMsSUFBZixDQUFSO0FBQUEsR0FBZDtBQUNBUixPQUFLUyxRQUFMO0FBQ0EsU0FBT1QsSUFBUDtBQUNEIiwiZmlsZSI6Im1pbWVwYXJzZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgTWltZU5vZGUgZnJvbSAnLi9ub2RlJ1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBwYXJzZSAoY2h1bmspIHtcbiAgY29uc3Qgcm9vdCA9IG5ldyBNaW1lTm9kZSgpXG4gIGNvbnN0IGxpbmVzID0gKHR5cGVvZiBjaHVuayA9PT0gJ29iamVjdCcgPyBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIGNodW5rKSA6IGNodW5rKS5zcGxpdCgvXFxyP1xcbi9nKVxuICBsaW5lcy5mb3JFYWNoKGxpbmUgPT4gcm9vdC53cml0ZUxpbmUobGluZSkpXG4gIHJvb3QuZmluYWxpemUoKVxuICByZXR1cm4gcm9vdFxufVxuIl19