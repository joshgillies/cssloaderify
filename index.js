var Core = require('css-modules-loader-core')
var through2 = require('through2')
var path = require('path')
var fs = require('fs')

// Modeled almost line for line from:
// https://github.com/css-modules/css-modules-loader-core/blob/1e15f28109fdf96c94d7a83cc465a197731e9726/src/file-system-loader.js
// HT Glen Maddern (@geelen)

function CSSLoader (root) {
  this.root = root
  this.sources = {}
  this.seenPaths = new Set()
  this.importNr = 0
}

CSSLoader.prototype.fetch = function fetch (_newPath, relativeTo, _trace) {
  var _self = this
  var newPath = _newPath.replace(/^["']|["']$/g, '')
  var trace = _trace || String.fromCharCode(_self.importNr++)

  return new Promise(function (resolve, reject) {
    var rootRelativePath = path.resolve(path.dirname(relativeTo), newPath)
    var fileRelativePath = _self.root + rootRelativePath

    fs.readFile(fileRelativePath, 'utf-8', function (err, source) {
      if (err) reject(err)
      Core.load(source, rootRelativePath, trace, _self.fetch.bind(_self))
        .then(function (result) {
          _self.sources[trace] = result.injectableSource
          resolve(result.exportTokens)
        }, reject)
    })
  })
}

CSSLoader.prototype.finalSource = function finalSource () {
  var _self = this

  // Sorts dependencies in the following way:
  // AAA comes before AA and A
  // AB comes after AA and before A
  // All Bs come after all As
  // This ensures that the files are always returned in the following order:
  // - In the order they were required, except
  // - After all their dependencies
  function traceKeySorter (a, b) {
    if (a.length < b.length) {
      return a < b.substring(0, a.length) ? -1 : 1
    } else if (a.length > b.length) {
      return a.substring(0, b.length) <= b ? -1 : 1
    } else {
      return a < b ? -1 : 1
    }
  }

  return Object.keys(_self.sources).sort(traceKeySorter).map(function (source) {
    return _self.sources[source]
  }).join('')
}

module.exports = function loader (file, options) {
  options = options || {}

  if (typeof options['auto-inject'] === 'undefined') {
    options['auto-inject'] = true
  }

  if (Array.isArray(options.plugins)) {
    Core.plugins = options.plugins
  }

  if (!/\.css$/i.test(file)) {
    return through2()
  }

  function noop (chunk, enc, cb) {
    cb()
  }

  function onEnd (cb) {
    var _self = this
    var requirePath = path.relative(path.dirname(file), __dirname)
    var loader = new CSSLoader(path.dirname(file))
    loader.fetch(path.basename(file), '/').then(function (tokens) {
      var stringifiedCss = JSON.stringify(loader.finalSource())
      var exportTokens = 'module.exports = ' + JSON.stringify(tokens) + ';'
      var exportStyles = 'module.exports.toString = function () { return ' + stringifiedCss + ' };'
      var moduleBody = options['auto-inject']
        ? '(require(' + JSON.stringify('./' + requirePath) + '))(' + stringifiedCss + ');' + exportTokens + exportStyles
        : exportTokens + exportStyles

      _self.push(moduleBody)
      cb()
    }, function (err) {
      console.error(err)
    })
  }

  return through2(noop, onEnd)
}
