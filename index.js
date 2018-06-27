var fs = require('fs');

var files = fs.readdirSync(__dirname + '/functions').filter(f => f.endsWith('.js'));

for (var i = 0; i < files.length; i++) {
	var filename = files[i].split('.')[0];
	module.exports[filename] = require(__dirname + '/functions/' + files[i]);
}
