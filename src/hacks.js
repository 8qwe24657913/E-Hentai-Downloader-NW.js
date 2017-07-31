'use strict';
//Object.assign shim
if (!Object.assign) Object.assign = function (target) {
	if (target === undefined || target === null) throw new TypeError('Cannot convert undefined or null to object');
	var output = Object(target);
	for (var i = 1, l = arguments.length; i < l; i++) {
		var source = arguments[i];
		if (source !== undefined && source !== null) for (var nextKey in source) if (source.hasOwnProperty(nextKey)) output[nextKey] = source[nextKey];
	}
	return output;
}

//Copy & paste & devtools
var gui = require('nw.gui');
var win = gui.Window.get();
function Menu() {
	this.menu = new gui.Menu();
	this.cut = new gui.MenuItem({
		label: 'Cut',
		click: function () {
			document.execCommand('cut');
		}
	});
	this.copy = new gui.MenuItem({
		label: 'Copy',
		click: function () {
			document.execCommand('copy');
		}
	});
	this.paste = new gui.MenuItem({
		label: 'Paste',
		click: function () {
			document.execCommand('paste');
		}
	});
	this.devtools = new gui.MenuItem({
		enabled: true,
		label: 'Devtools',
		click: function () {
			win.showDevTools();
		}
	});
	this.menu.append(this.cut);
	this.menu.append(this.copy);
	this.menu.append(this.paste);
	this.menu.append(this.devtools);
}
Menu.prototype.popup = function (x, y) {
	this.menu.popup(x, y);
};
var menu = new Menu();
document.addEventListener('contextmenu', function (e) {
	e.preventDefault();
	var haveClipData = gui.Clipboard.get().get().length > 0,
		isInput = 'INPUT' === e.target.tagName && 'button' !== e.target.type,
		selected = 'RANGE' === window.getSelection().type.toUpperCase();
	menu.cut.enabled = isInput && selected;
	menu.copy.enabled = selected;
	menu.paste.enabled = isInput && haveClipData;
	menu.popup(e.x, e.y);
});

//Minimize to tray
win.on('minimize', function () {
	this.hide();
	new gui.Tray({
		icon: 'icon.png'
	}).on('click', function () {
		win.show();
		this.remove();
	});
});

//Avoid blinking when starts
window.addEventListener('load', function () {
    win.show();
});

function po(fn, ctx) {
    return function(...args) {
        ctx = ctx || global || window;
        return new Promise(function(res, rej) {
            args.push(function(err, ret) {
                if (err) return rej(err);
                res(ret);
            });
            try {
                fn.apply(ctx, args);
            } catch (err) {
                rej(err);
            }
        });
    };
};