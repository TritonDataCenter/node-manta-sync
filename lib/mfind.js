var path = require('path');
var async = require('async');

module.exports = mfind;

function mfind(client, basedir, cb) {
  var dirs = 0;
  var searched = 0;
  var files = [];
  var calledback = false;

  function _mfind(searchdir) {
    dirs++;
    client.ls(searchdir, function(err, res) {
      res.on('directory', function(dir) {
        if (calledback) return;
        var d = path.join(searchdir, dir.name);
        _mfind(d);
      });

      res.on('object', function(obj) {
        if (calledback) return;
        var file = path.join(searchdir, obj.name);
        files.push(file);
      });

      res.on('error', function(err) {
        calledback = true;
        cb(err);
      });

      res.on('end', function() {
        if (calledback) return;
        if (++searched === dirs)
          cb(null, files);
      });
    });
  }

  _mfind(basedir);
}
