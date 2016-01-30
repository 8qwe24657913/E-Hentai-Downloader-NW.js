'use strict';
var co = require('co'),
	po = require('po'),
	fs = require('fs'),
	http = require('http'),
	url = require('url'),
	stream = require('stream'),
	gui = require('nw.gui');

window.addEventListener('dragover', function (e) { //Todo: drop resume.txt to ehd window
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', function (e) {
    e.preventDefault();
});

function ERRLOG(err) {
	console.error(err);
	throw err;
}
const ehD = {
	conf: {},
	defConf: {
		cookie: '',
		'thread-count': 5,
		timeout: 300,
		'retry-count' : 3,
		'dir-name': '{gid}_{token}',
		'number-images': true,
		'number-separator': '：',
		'force-resized': false,
		'number-real-index': false,
		'never-new-url': false,
		'never-send-nl': false
	},
	DOM: {
		settingPanel: 'ehD-setting',
		url: 'ehD-url',
		numberInput: 'ehD-number',
		range: 'ehD-range',
		dialog: 'ehD-dialog'
	},
	read: po(fs.readFile, fs),
	write: po(fs.writeFile, fs),
	unlink: po(fs.unlink, fs),
	stat: po(fs.stat, fs),
	mkdir: po(fs.mkdir, fs),
	getReqOpt(href) {
		var proxy = gui.App.getProxyForURL(href).match(/^PROXY\s+([^:]+):(\d+)/),
			parsed = url.parse(href),
			opts = proxy ? {
				path: href,
				host: proxy[1],
				port: Number(proxy[2]),
				headers: {
					Host: parsed.hostname || parsed.host
				}
			} : parsed;
		opts.headers || (opts.headers = {});
		opts.headers.cookie = this.conf.cookie;
		return opts;
	},
	get: po(function (href, code, callback) {
		if (!callback) callback = code, code = {};
		var req = http.get('[object String]' === ({}).toString.call(href) ? ehD.getReqOpt(href) : href, function (res) {
			var chunks = [];
			res.on('data', function (chunk) {
				chunks.push(chunk);
			}).on('end', function () {
				return callback(undefined, Buffer.concat(chunks).toString());
			});
			code.res && code.res(res, req);
		});
		code.req && code.req(req);
		req.on('error', callback);
		req.end();
		return req;
	}),
	getPage: function (getUrl, callback, onfail) {
		var url, request, retryCount = 0, successed = true,
			code = {
				req: function (req) {
					request = req;
					req.setTimeout(30000, fail);
				},
				res: function (res) {
					if (res.statusCode != 200) fail();
				}
			};
		function send() {
			if (successed) url = getUrl();
			if (url) ehD.get(url, code).then(function (result) {
				retryCount = 0;
				successed = true;
				request = null;
				try {
					callback(result, send, fail)
				} catch (e) {
					ERRLOG(e);
					fail();
				}
			}, fail).catch(ERRLOG);
		}
		function fail() {
			request.abort();
			request = null;
			successed = false;
			if (onfail) {
				try {
					return onfail(send);
				} catch (e) {
					return ERRLOG(e);
				}
			}
			if (retryCount < ehD.conf['retry-count']) {
				pushDialog('Failed! Retrying... ');
				retryCount++;
				send();
			} else {
				pushDialog('Failed!\nFetch images\' URL failed, Please try again later.');
				isDownloading = false;
				alert('Fetch images\' URL failed, Please try again later.');
			}
		}
		send();
	},
	save() {
		var inputs = this.DOM.settingPanel.querySelectorAll('input[data-ehd-setting]'),
			conf = {};
		for (var input of inputs) {
			var value, type = input.getAttribute('type'),
				name = input.dataset.ehdSetting;
			if ('checkbox' === type) {
				conf[name] = input.checked;
			} else if ('' !== (value = input.value)) {
				conf[name] = type == 'number' ? Number(value) : value;
			}
		};
		conf['number-images'] = this.DOM.numberInput.checked;
		return this.write('config.json', JSON.stringify(Object.assign(this.conf, this.defConf, conf), null, '\t'), 'utf8').catch(ERRLOG);
	},
	setData(conf) {
		conf = Object.assign(this.conf, this.defConf, conf);
		for (var i in conf) {
			var element = this.DOM.settingPanel.querySelector('input[data-ehd-setting="' + i + '"]');
			if (!element) continue;
			if (element.getAttribute('type') == 'checkbox') conf[i] && element.setAttribute('checked', 'checked');
			else element.setAttribute('value', conf[i]);
		}
		this.DOM.numberInput.checked = conf['number-images'];
	},
	regEvents() {
		document.getElementById('save').addEventListener('click', this.save.bind(this));
		document.getElementById('cancel').addEventListener('click', this.setData.bind(this, null));
		document.getElementById('exit').addEventListener('click', function () {
			gui.App.closeAllWindows();
		});
		document.getElementsByClassName('ehD-start')[0].addEventListener('click', co.wrap(function *(event) {
			event.preventDefault();
			if (isDownloading && !confirm('E-Hentai Downloader is working now, are you sure to stop downloading and start a new download?')) return;
			if (globals.apiuid == -1 && !confirm('You are not log in to E-Hentai Forums, so you can\'t download original image. Continue?')) return;
			ehD.DOM.dialog.innerHTML = '';
			ehD.DOM.dialog.classList.remove('hide');
			try {
				yield parseGlobals(ehD.DOM.url.value);
			} catch (e) {
				return ERRLOG(e);
			}
			if (ehD.DOM.range.value.trim() == '') {
				if (pagesRange.length) pagesRange = [];
				ehDownload();
			} else getAllPagesURL();
		}));
		window.onbeforeunload = function () {
			ehDownloadFS.removeFile(globals.gid + '.zip');
			if (isDownloading) return 'E-Hentai Downloader is still running, please don\'t close this tab before it finish downloading.';
		};
	},
	writeDefConf(e) {
		console.warn('config.json is missing or broken, error message:', e, 'trying applying default config.');
		this.write('config.json', JSON.stringify(this.defConf, null, '\t'), 'utf8').catch(ERRLOG);
		return null;
	},
	init: co.wrap(function * () {
		var DOM = this.DOM;
		for (var i in DOM) DOM[i] = document.getElementsByClassName(DOM[i])[0];
		this.regEvents();
		Object.assign(this.conf, this.defConf);
		this.setData(yield this.read('config.json', 'utf8').then(function (txt) {
			try {
				return JSON.parse(txt);
			} catch (e) {
				return this.writeDefConf(e);
			}
		}, this.writeDefConf.bind(this)));
	})
};
document.addEventListener('DOMContentLoaded', function () {
	ehD.init().catch(ERRLOG)
});

var globals = {};
//parseGlobals("http://r.e-hentai.org/g/893950/c0b2a99b2b/").then(function(e){console.log(e)},ERRLOG);

var parseGlobals = co.wrap(function * (url) {
    function parse(txt, reg) {
		var res = reg.exec(txt), l = res.length;
		while (--l > 0) globals[reg.arr[l - 1]] = res[l];
    }
    var reg1 = /var base_url \= "([^"]+)";\nvar gid = (\d+);\nvar token \= "([^"]+)";\nvar apiuid \= (\-?\d+);\nvar apikey \= "([^"]+)";\nvar original_rating \= (\d+(?:\.\d+)?);/g,
        reg2 = /\<h1 id\="gn"\>([^\<]*)\<\/h1\>\<h1 id\="gj"\>([^\<]*)\<\/h1\>.*alt="([^"]+)" class="ic".*\<div id\="gdn"\>\<a [^\<]+\>([^\<]+)\<\/a\>/g,
        reg3 = /class\="gdt1"[^\>]*\>([^\<]+)<\/td\><td [^\>]*class\="gdt2"[^\>]*\>([^\<]+)\</g,
        reg4 = /onclick\="sp\((\d+)\)"/g,
		reg5 = /\<a href\="([^"]+)"\>\<img alt\="/,
        reg6 = / id\="comment_0"[^>]*\>(.+?)\<\/div\>/;
    reg1.arr = ['base_url', 'gid', 'token', 'apiuid', 'apikey', 'original_rating'];
    reg2.arr = ['title', 'subtitle', 'tag', 'uploader'];
    var match, e, txt = yield ehD.get(url = url.split('?', 1)[0]);
	globals = {url};
    // r.e-hentai.org points all links to g.e-hentai.org
    if (url.startsWith('http://r.e-hentai.org/')) {
        globals.origin = 'http://g\\.e-hentai\\.org';
        globals.isREH = true;
    } else globals.origin = url.match(/^[^\/]+\/\/[^\/]+/)[0].split('.').join('\\.');
	// js variables
    parse(txt, reg1, globals);
    for (e of ['gid', 'apiuid', 'original_rating']) globals[e] -= 0;
	// gallery information
    parse(txt, reg2, globals);
    for (e of reg2.arr) globals[e] = getPurifyName(globals[e]);
    globals.subtitle = globals.subtitle || globals.title;
	// description
    var desc = globals.description = [];
    while (match = reg3.exec(txt)) desc.push((match[1] + ' ' + match[2]).replaceHTMLEntites());
	// page num
    var max = 0;
    while (match = reg4.exec(txt)) if ((match = Number(match[1])) > max) max = match;
    globals.pageNum = max;
	//first url
	globals.firstUrl = reg5.exec(txt)[1].replaceOrigin();
	// uploader comment
    if (match = reg6.exec(txt)) globals.uploaderComment = match[1].replace(/<br>|<br \/>/gi, '\n');
    return globals
});

// ==========---------- Main Function Starts Here ----------========== //
var retryCount = 0;
var imageList = [];
var imageData = [];
var logStr;
var fetchCount = 0;
var downloadedCount = 0;
var fetchThread = [];
var dirName;
var failedCount = 0;
var progressTable = null;
var pagesRange = [];
var isDownloading = false;
var pageURLsList = [];
var getAllPagesURLFin = false;


String.prototype.replaceHTMLEntites = (function () {
	var entitesList = {'euro':'€','nbsp':' ','quot':'"','amp':'&','lt':'<','gt':'>','iexcl':'¡','cent':'¢','pound':'£','curren':'¤','yen':'¥','brvbar':'¦','sect':'§','uml':'¨','copy':'©','ordf':'ª','not':'¬','shy':'','reg':'®','macr':'¯','deg':'°','plusmn':'±','sup2':'²','sup3':'³','acute':'´','micro':'µ','para':'¶','middot':'·','cedil':'¸','sup1':'¹','ordm':'º','raquo':'»','frac14':'¼','frac12':'½','frac34':'¾','iquest':'¿','Agrave':'À','Aacute':'Á','Acirc':'Â','Atilde':'Ã','Auml':'Ä','Aring':'Å','AElig':'Æ','Ccedil':'Ç','Egrave':'È','Eacute':'É','Ecirc':'Ê','Euml':'Ë','Igrave':'Ì','Iacute':'Í','Icirc':'Î','Iuml':'Ï','ETH':'Ð','Ntilde':'Ñ','Ograve':'Ò','Oacute':'Ó','Ocirc':'Ô','Otilde':'Õ','Ouml':'Ö','times':'×','Oslash':'Ø','Ugrave':'Ù','Uacute':'Ú','Ucirc':'Û','Uuml':'Ü','Yacute':'Ý','THORN':'Þ','szlig':'ß','agrave':'à','aacute':'á','acirc':'â','atilde':'ã','auml':'ä','aring':'å','aelig':'æ','ccedil':'ç','egrave':'è','eacute':'é','ecirc':'ê','euml':'ë','igrave':'ì','iacute':'í','icirc':'î','iuml':'ï','eth':'ð','ntilde':'ñ','ograve':'ò','oacute':'ó','ocirc':'ô','otilde':'õ','ouml':'ö','divide':'÷','oslash':'ø','ugrave':'ù','uacute':'ú','ucirc':'û','uuml':'ü','yacute':'ý','thorn':'þ'};
	function matchEntity(str, entity, matches) {
		if (matches = entitesList[entity]) return matches;
		else if (matches = entity.matches(/#(\d+)/)) return String.fromCharCode(matches[1] - 0);
		else return str;
	}
	return function () {
		return this.replace(/&(#x?\d+|[a-zA-Z]+);/g, matchEntity);
	};
}());

// Fixed cross origin in r.e-hentai.org
// 发现 prototype 好方便 _(:3
// Added By 8qwe24657913: 然后你就会发现只要一for in就必须hasOwnProperty……
String.prototype.replaceOrigin = function () {
	return globals.isREH ? this.replace('g.e-hentai.org', 'r.e-hentai.org') : this.toString();
};

function pushDialog(str) {
	if (typeof str === 'string') ehD.DOM.dialog.innerHTML += str.replace(/\n/gi, '<br>');
	else ehD.DOM.dialog.appendChild(str);
	ehD.DOM.dialog.scrollTop = ehD.DOM.dialog.scrollHeight;
}

function getReplacedName(str) {
	return str.replace(/{(gid|token|title|subtitle|tag|uploader)}/gi, function (match, name) {
		return globals[name]
	}).replaceHTMLEntites();
}

function getPurifyName(name) {
	return name.trim().replace(/[:"*?|<>\/\\\n]/g, '-');
}

var fileNames = {};
function getUniqueFileName(pageData) {
	var oriName = pageData.imageName;
	if (ehD.conf['number-images']) return pageData.imageName = pageData.imageNumber + (ehD.conf['number-separator'] || '：') + oriName;
	var name = oriName.toLowerCase();
	if (!fileNames[name]) return (fileNames[name] = 1, oriName);
	var index = name.lastIndexOf('.'), prefix = name.substr(0, index), suffix = name.substr(index), count = 1;
	while (fileNames[name = prefix + (++count) + suffix]);
	fileNames[name] = 1;
	return pageData.imageName = oriName.substr(0, index) + count + oriName.substr(index);
}

function PageData(pageURL, imageURL, imageName, nextNL, realIndex) {
	this.pageURL = pageURL.split('?')[0];
	this.imageURL = imageURL;
	this.imageName = getPurifyName(imageName);
	this.nextNL = nextNL;
	this.realIndex = realIndex;
	this.imageNumber = '';
}

function failedFetching(index, node) {
	var image = imageList[index];
	fetchThread[index].abort();
	console.error('[EHD] Index >', (index + 1), ' | RealIndex >', image.realIndex, ' | Name >', image.imageName, ' | RetryCount >', retryCount[index], ' | DownloadedCount >', downloadedCount, ' | FetchCount >', fetchCount, ' | FailedCount >', failedCount);
	if (retryCount[index] < ehD.conf['retry-count']) {
		retryCount[index]++;
		fetchOriginalImage(index, node);
	} else {
		node.innerHTML = '<td style="word-break: break-all;">#' + image.realIndex + ': ' + image.imageName + '</td><td width="210" style="position: relative;"><progress style="width: 200px;" value="0"></progress><span style="position: absolute; width: 100%; text-align: center; color: #34353b; left: 0; right: 0;"></span></td><td style="color: #ff0000;">Failed!</td>';
		failedCount++;
		fetchCount--;
		if (fetchCount == 0) {
			fetchImg.abortAll();
			if (confirm('Some images were failed to download. Would you like to try them again?')) {
				retryAllFailed();
			} else {
				pushDialog('\nFetch images failed.');
				fetchImg.suspend();
				alert('Fetch images failed, Please try again later.');
				isDownloading = false;
			}
		} else {
			if (downloadedCount + failedCount < imageList.length) {
				fetchImg.addThreads();
			}
		}
	}
}

function fetchOriginalImage(index, node, url) {
	var image = imageList[index];
	if (!retryCount[index]) retryCount[index] = 0;
	if (!url) ehD.DOM.dialog.scrollTop = ehD.DOM.dialog.scrollHeight;
	var options = ehD.getReqOpt(image.imageURL);
	options.headers.referer = options.headers['x-alt-referer'] = image.pageURL;
	options.method = 'GET';
	var speedInfo = {
		lastTimestamp: 0,
		lastProgress: 0,
		loaded: 0,
		total: 0
	};
	var req = http.request(options, function (res) {
		if (res.statusCode !== 200) {
			req.abort();
			if (301 === res.statusCode) {
				fetchOriginalImage(index, node, image.imageURL = res.headers.location);
			} else if (302 === res.statusCode) {
				fetchOriginalImage(index, node, res.headers.location);
			} else if (500 === res.statusCode) {
				console.log('[EHD] #' + (index + 1) + ': 500 code received.(See: https://github.com/ccloli/E-Hentai-Downloader/issues/16 )');
				failedFetching(index, node);
			} else fetchImg.fail('Wrong Response Status (See: https://github.com/ccloli/E-Hentai-Downloader/issues/16 )', 'Wrong Status', index, node, res);
			return;
		}
		if (!res.headers['content-type'] || res.headers['content-type'].split('/')[0].trim() != 'image') {
			req.abort();
			return fail('Wrong Content-Type', 'Wrong MIME', index, node, res);
		}
		var matches = res.rawHeaders.join('\n').match(/filename=([\s\S]+?)\n/);
		if (matches) image.imageName = getPurifyName(matches[1]);
		var path = dirName + getUniqueFileName(image);
		speedInfo.total = res.headers['content-length'];
		fetchImg.listenAndPipe(res, fs.createWriteStream(path, 'binary'), speedInfo.total ? function (chunk) {
			var t = new Date().getTime();
			speedInfo.loaded += chunk.length;
			if (!speedInfo.lastTimestamp) {
				speedInfo.lastTimestamp = t;
			} else if (t - speedInfo.lastTimestamp >= 1000) {
				node.progressText.innerHTML = Number(speedInfo.lastProgress / (t - speedInfo.lastTimestamp) / 1.024).toFixed(2) + ' KB/s';
				speedInfo.lastTimestamp = t;
				speedInfo.lastProgress = speedInfo.loaded;
			}
			node.progress.setAttribute('value', speedInfo.loaded / speedInfo.total);
		} : function (chunk) {
			speedInfo.loaded += chunk.length;
		});
		res.on('end', function () {
			fetchImg.onload(res, path, index, node, speedInfo);
		});
		node.status.innerHTML = retryCount[index] == 0 ? 'Downloading...' : 'Retrying (' + retryCount[index] + '/' + ehD.conf['retry-count'] + ') ...';
		node.status.style.cssText = '';
	});
	if (0 != ehD.conf['timeout']) req.setTimeout(ehD.conf['timeout'] * 1000, function () {
		req.abort();
		return fetchImg.ontimeout(index, node);
	});
	req.on('error', function (e) {
		return fetchImg.onerror(e, index, node);
	});
	req.end();
	fetchThread[index] = req;
}
var fetchImg = {
	listenAndPipe(from, to, listener) {
		var transform = new stream.Transform();
		transform._transform = function (data, encoding, callback) {
			listener(data);
			callback(null, data);
		}
		return from.pipe(transform).pipe(to);
	},
	fail(str1, str2, index, node, res, path) {
		console.log('[EHD] #' + (index + 1) + ': ' + str1);
		res && console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index].realIndex, ' | Status >', res.statusCode, ' | StatusText >', res.statusMessage + '\nResposeHeaders >' + res.headers);
		node.progress.setAttribute('value', '0');
		node.progressText.innerHTML = '';
		node.status.innerHTML = 'Failed! (' + str2 + ')';
		node.status.style.color = '#ffff00';
		path ? ehD.unlink(path).then(failedFetching.bind(undefined, index, node)).catch(ERRLOG) : failedFetching(index, node);
	},
	addContinueButton() {
		var continueButton = document.createElement('button');
		continueButton.innerHTML = 'Continue Downloading';
		continueButton.addEventListener('click', function () {
			fetchCount = 0;
			ehD.DOM.dialog.removeChild(continueButton);
			fetchImg.addThreads();
		});
		ehD.DOM.dialog.appendChild(continueButton);
	},
	addThreads() {
		for (var node, i = fetchCount, j = 0; i < (ehD.conf['thread-count'] || 1); i++) {
			for (; j < imageList.length; j++) {
				if (imageData[j]) continue;
				if (retryCount[j] == ehD.conf['retry-count']) {
					imageData[j] = 'Failed';
					console.log('[EHD] #' + (index + 1) + 'reached retry count!');
					continue;
				}
				imageData[j] = 'Fetching';
				node = document.createElement('tr');
				node.innerHTML = '<td style="word-break: break-all;">#' + imageList[j].realIndex + ': ' + imageList[j].imageName + '</td><td width="210" style="position: relative;"><progress style="width: 200px;"></progress><span style="position: absolute; width: 100%; text-align: center; color: #34353b; left: 0; right: 0;"></span></td><td>Pending...</td>';
				progressTable.appendChild(node);
				node = {
					fileName: node.getElementsByTagName('td')[0],
					status: node.getElementsByTagName('td')[2],
					progress: node.getElementsByTagName('progress')[0],
					progressText: node.getElementsByTagName('span')[0]
				}
				fetchOriginalImage(j, node);
				fetchCount++;
				break;
			}
		}
	},
	suspend() {
		//Todo: add resume.txt
		this.writeInfo();
	},
	writeInfo() {
		for (var elem of imageList) logStr += '\n\nPage ' + elem.realIndex + ': ' + elem.pageURL + '\nImage ' + elem.realIndex + ': ' + elem.imageName /*+ '\nImage URL: ' + elem.imageURL*/; // Image URL may useless, see https://github.com/ccloli/E-Hentai-Downloader/issues/6
		pushDialog('\n\nFinish downloading at ' + new Date());
		logStr += '\n\nFinish downloading at ' + new Date() + '\n\nGenerated by E-Hentai Downloader for NW.js(https://github.com/8qwe24657913/E-Hentai-Downloader-NW.js). Thanks to E-Hentai Downloader(https://github.com/ccloli/E-Hentai-Downloader)';
		ehD.write(dirName + 'info.txt', logStr.replace(/\n/gi, '\r\n'), 'utf8').catch(ERRLOG);
	},
	abortAll() {
		for (var thread of fetchThread) thread.abort();
	},
	onload(res, path, index, node, speedInfo) {
		function fail(a, b) {
			fetchImg.fail(a, b, index, node, res, path)
		};
		if (!speedInfo.loaded) {
			return fail('Empty Response (See: https://github.com/ccloli/E-Hentai-Downloader/issues/16 )', 'Empty Response');
		}
		if (speedInfo.loaded == 925) { // '403 Access Denied' Image Byte Size
			return fail('403 Access Denied', 'Error 403');
		}
		if (speedInfo.loaded == 28) { // 'An error has occurred. (403)' Length
			return fail('An error has occurred. (403)', 'Error 403');
		}
		if (speedInfo.loaded == 141) { // Image Viewing Limits String Byte Size
			this.abortAll();
			fail('Exceed Image Viewing Limits', 'Exceed Limits');
			pushDialog('\nYou have exceeded your image viewing limits.');
			if (confirm('You have exceeded your image viewing limits. You can reset these limits at home page.\n\nYou can try reseting your image viewing limits to continue by paying your GPs. Reset now?') && (globals.apiuid != -1 ? 1 : (alert('Sorry, you are not log in!'), 0))) {
				pushDialog('Please reset your viewing limits at http://g.e-hentai.org/home.php in your browser.\nAfter reseting your viewing limits, click the button below to continue.\n');
				return addContinueButton();
			} else {
				this.suspend();
				alert('You have exceeded your image viewing limits.');
			}
			isDownloading = false;
			return;
		} else if (speedInfo.loaded == 28658) { // '509 Bandwidth Exceeded' Image Byte Size
			this.abortAll();
			fail('509 Bandwidth Exceeded', 'Error 509');
			if (confirm('You have temporarily reached the limit for how many images you can browse. You can\n- Sign up/in E-Hentai account at E-Hentai Forums to get double daily quota if you are not sign in.\n- Run the Hentai@Home to support E-Hentai and get more points to increase your limit.\n- Check back in a few hours, and you will be able to download more.\n\nYou can try reseting your image viewing limits to continue by paying your GPs. Reset now?') && (globals.apiuid != -1 ? 1 : (alert('Sorry, you are not log in!'), 0))) {
				pushDialog('Please reset your viewing limits at http://g.e-hentai.org/home.php in your browser.\nAfter reseting your viewing limits, click the button below to continue.\n');
				return addContinueButton();
			} else {
				this.suspend();
				alert('You have exceeded your image viewing limits.');
			}
			isDownloading = false;
			return;
		}
		node.fileName.innerHTML = '#' + imageList[index].realIndex + ': ' + imageList[index].imageName;
		node.progress.setAttribute('value', '1');
		node.progressText.innerHTML = '100%';
		node.status.innerHTML = 'Succeed!';
		node.status.style.color = '#00ff00';
		imageData[index] = 'Fetched';
		downloadedCount++;
		console.log('[EHD] Index >', index, ' | RealIndex >', imageList[index].realIndex, ' | Name >', imageList[index].imageName, ' | RetryCount >', retryCount[index], ' | DownloadedCount >', downloadedCount, ' | FetchCount >', fetchCount, ' | FailedCount >', failedCount);
		fetchCount--;
		if (downloadedCount + failedCount < imageList.length) { // download not finished, some files are not being called to download
			fetchImg.addThreads();
		} else if (failedCount > 0) { // all files are called to download and some files can't be downloaded
			if (fetchCount == 0) { // all files are finished downloading
				fetchImg.abortAll();
				if (confirm('Some images were failed to download. Would you like to try them again?')) {
					retryAllFailed();
				} else {
					pushDialog('\nFetch images failed.');
					fetchImg.suspend();
					alert('Fetch images failed, Please try again later.');
					isDownloading = false;
				}
			}
		} else { // all files are downloaded successfully
			fetchImg.writeInfo();
			isDownloading = false;
		}
	},
	onerror(e, index, node) {
		return this.fail('Network Error', e, index, node);
	},
	ontimeout(index, node) {
		return this.fail('Timed Out', 'Timed Out', index, node);
	}
};

function retryAllFailed() {
	var index, refetch = 0;
	progressTable = document.createElement('table');
	progressTable.style.width = '100%';
	for (index = 0; index < imageData.length; index++) {
		if (imageData[index] == 'Fetching') {
			imageData[index] = null;
			retryCount[index] = 0;
		}
	}
	if (!ehD.conf['never-new-url']) {
		var fetchURL, index = 0;
		ehD.getPage(function () {
			for (; index < imageData.length; index++) {
				if (imageData[index] != null) continue;
				var image = imageList[index];
				if (image.imageURL.indexOf('fullimg.php') < 0) {
					image.pageURL = fetchURL = (image.pageURL + ((!ehD.conf['never-send-nl'] && image.nextNL) ? (image.pageURL.indexOf('?') >= 0 ? '&' : '?') + 'nl=' + image.nextNL : '')).replaceHTMLEntites();
					pushDialog('Fetching Page ' + (index + 1) + ': ' + fetchURL + ' ... ');
					refetch = 1;
					return fetchURL;
				} else failedCount--;
			}
			return fetchURL;
		}, function (result, send, fail) {
			var image = imageList[index];
			var imageURL = (globals.apiuid != -1 && result.indexOf('fullimg.php') >= 0 && !ehD.conf['force-resized']) ? result.match(RegExp('<a href="(' + globals.origin + '\/fullimg\\.php\\?\\S+?)"'))[1].replaceHTMLEntites() : result.indexOf('id="img"') > -1 ? result.match(/<img id="img" src="(\S+?)"/)[1].replaceHTMLEntites() : result.match(/<\/iframe><a[\s\S]+?><img src="(\S+?)"/)[1].replaceHTMLEntites(); // Sometimes preview image may not have id="img"
			image.imageURL = imageURL;
			var nextNL = /return nl\('[\d-]+'\)/.test(result) ? result.match(/return nl\('([\d-]+)'\)/)[1] : null;
			image.nextNL = nextNL;
			failedCount--;
			pushDialog('Succeed!\nImage ' + (index + 1) + ': ' + imageURL + '\n');
			if (failedCount == 0) {
				ehD.DOM.dialog.appendChild(progressTable);
				fetchImg.addThreads();
			} else {
				++index;
				send();
			}
		}, function (send) {
			if (retryCount < ehD.conf['retry-count']) {
				pushDialog('Failed! Retrying... ');
				retryCount++;
				send();
			} else {
				pushDialog('Failed! Skip and continue...');
				refetch = 0;
				++index;
				send();
				if (!refetch) {
					ehD.DOM.dialog.appendChild(progressTable);
					fetchImg.addThreads();
				}
			}
		});
	}
	if (!refetch) {
		ehD.DOM.dialog.appendChild(progressTable);
		fetchImg.addThreads();
	}
}

function getAllPagesURL() {
	pagesRange = [];
	var pagesRangeText = ehD.DOM.range.value.replace(/，/g, ',').trim();
	console.log('[EHD] Pages Range >', pagesRangeText);
	if (!/^(\d+(-\d+)?\s*?,\s*?)*\d+(-\d+)?$/.test(pagesRangeText)) {
		ehD.DOM.dialog.classList.add('hide');
		return alert('Pages Range is not correct.');
	}
	var pagesRangeScale = pagesRangeText.match(/\d+-\d+|\d+/g);
	pagesRangeScale.forEach(function (elem) {
		if (elem.indexOf('-') < 0) {
			var curElem = Number(elem);
			if (!pagesRange.some(function (e) {
				return curElem == e;
			})) pagesRange.push(curElem);
		} else {
			for (var i = Number(elem.split('-')[0]); i <= Number(elem.split('-')[1]); Number(elem.split('-')[0]) < Number(elem.split('-')[1]) ? i++ : i--) {
				if (!pagesRange.some(function (e) {
					return i == e;
				})) pagesRange.push(i);
			}
		}
	});
	pagesRange.sort(function (a, b) {
		return a > b ? 1 : -1;
	});
	if (!getAllPagesURLFin) {
		pageURLsList = [];
		var pagesCount = globals.pageNum;
		var curPage = 0;
		var prefix = url.parse(globals.url);
		prefix = prefix.protocol + (prefix.hostname || prefix.host) + prefix.pathname;
		ehD.getPage(function () {
			return prefix + '?p=' + curPage
		}, function (result, send, fail) {
			if (!result) return fail();
			var pagesURL = result.split('<div id="gdt">')[1].split('<div class="c">')[0].match(/(?:<a href=").+?(?=")/gi);
			for (var i = 0; i < pagesURL.length; i++) {
				pageURLsList.push(pagesURL[i].split('"')[1].replaceHTMLEntites().replaceOrigin());
			}
			pushDialog('Succeed!');
			curPage++;
			if (curPage == pagesCount) {
				getAllPagesURLFin = true;
				var wrongPages = pagesRange.filter(function (elem) {
					return elem > pageURLsList.length;
				});
				if (wrongPages.length != 0) {
					pagesRange = pagesRange.filter(function (elem) {
						return elem <= pageURLsList.length;
					});
					alert('Page ' + wrongPages.join(', ') + (wrongPages.length > 1 ? ' are' : ' is') + ' not exist, and will be ignored.');
				}
				pushDialog('\n\n');
				ehDownload();
			} else {
				send();
				pushDialog('\nFetching Archive Pages URL (' + (curPage + 1) + '/' + pagesCount + ') ... ');
			}
		});
		pushDialog('\nFetching Archive Pages URL (' + (curPage + 1) + '/' + pagesCount + ') ... ');
	} else {
		var wrongPages = pagesRange.filter(function (elem) {
			return elem > pageURLsList.length;
		});
		if (wrongPages.length != 0) {
			pagesRange = pagesRange.filter(function (elem) {
				return elem <= pageURLsList.length;
			});
			alert('Page ' + wrongPages.join(', ') + (wrongPages.length > 1 ? ' are' : ' is') + ' not exist, and will be ignored.');
		}
		ehDownload();
	}
}

var ehDownload = co.wrap(function * () {
	fetchImg.abortAll();
	imageList = [];
	imageData = [];
	fetchThread = [];
	dirName = getReplacedName(ehD.conf['dir-name'] || '{gid}_{token}') + '/';
	try {
		if (!(yield ehD.stat(dirName)).isDirectory()) {
			if (confirm('There is a file whose name is duplicated with dirName. Do you want to unlink it?')) {
				yield ehD.unlink(dirName);
				yield ehD.mkdir(dirName);
			} else return;
		}
	} catch (e) {
		if (-4058 !== e.errno) return ERRLOG(e);
		try {
			yield ehD.mkdir(dirName);
		} catch (e) {
			return ERRLOG(e);
		}
	}
	var index = 1;
	downloadedCount = fetchCount = failedCount = 0;
	ehD.conf['number-images'] = ehD.DOM.numberInput.checked;
	logStr = globals.title + '\n' + (globals.title === globals.subtitle) ? '' : (globals.subtitle + '\n') + globals.url.replaceHTMLEntites() + '\n\n' + 'Category: ' + globals.tag + '\n' + 'Uploader: ' + globals.uploader + '\n';
	logStr += globals.description.join('\n') + '\n'
	logStr += 'Rating: ' + globals.original_rating + '\n\n';
	if (globals.uploaderComment) logStr += globals.uploaderComment + '\n\n';
	isDownloading = true;
	progressTable = document.createElement('table');
	progressTable.style.width = '100%';
	pushDialog(logStr);
	var fetchURL;
	if (getAllPagesURLFin) {
		var rangeIndex = 0;
		if (pagesRange.length == 0) fetchURL = pageURLsList[rangeIndex];
		else fetchURL = pageURLsList[pagesRange[rangeIndex] - 1];
	} else {
		pageURLsList = [];
		fetchURL = globals.firstUrl;
	}
	ehD.getPage(function () {
		return fetchURL;
	}, function (result, send, fail) {
		if (!result) return fail();
		var realIndex = (pagesRange.length != 0 ? pagesRange[Math.min(rangeIndex, pagesRange.length - 1)] : index);
		if (getAllPagesURLFin) {
			rangeIndex++;
			if (pagesRange.length == 0) var nextFetchURL = pageURLsList[Math.min(rangeIndex, pageURLsList.length - 1)];
			else var nextFetchURL = pageURLsList[pagesRange[Math.min(rangeIndex, pagesRange.length - 1)] - 1];
		} else {
			pageURLsList.push(fetchURL);
			var nextFetchURL = result.indexOf('<a id="next"') >= 0 ? result.match(RegExp('<a id="next"[\\s\\S]+?href="(' + globals.origin + '\\/s\\/\\S+?)"'))[1].replaceHTMLEntites().replaceOrigin() : result.match(RegExp('<a href="(' + globals.origin + '\\/s\\/\\S+?)"><img src="http://ehgt.org/g/n.png"'))[1].replaceHTMLEntites().replaceOrigin();
		}
		var imageURL = (globals.apiuid != -1 && result.indexOf('fullimg.php') >= 0 && !ehD.conf['force-resized']) ? result.match(RegExp('<a href="(' + globals.origin + '\/fullimg\\.php\\?\\S+?)"'))[1].replaceHTMLEntites().replaceOrigin() : result.indexOf('id="img"') > -1 ? result.match(/<img id="img" src="(\S+?)"/)[1].replaceHTMLEntites() : result.match(/<\/iframe><a[\s\S]+?><img src="(\S+?)"/)[1].replaceHTMLEntites(); // Sometimes preview image may not have id="img"
		var fileName = result.match(/g\/l.png" \/><\/a><\/div><div>([\s\S]+?) :: /)[1].replaceHTMLEntites();
		var nextNL = /return nl\('[\d-]+'\)/.test(result) ? result.match(/return nl\('([\d-]+)'\)/)[1] : null;
		imageList.push(new PageData(fetchURL, imageURL, fileName, nextNL, realIndex));
		index++;
		pushDialog('Succeed!\nImage ' + realIndex + ': ' + imageURL + '\n');
		if (nextFetchURL != fetchURL) {
			fetchURL = nextFetchURL;
			pushDialog('Fetching Page ' + (pagesRange.length != 0 ? pagesRange[Math.min(rangeIndex, pagesRange.length - 1)] : index) + ': ' + fetchURL + ' ... ');
			return send();
		}
		getAllPagesURLFin = true;
		if (ehD.conf['number-images']) {
			// Number images, thanks to JingJang@GitHub, source: https://github.com/JingJang/E-Hentai-Downloader
			if (pagesRange.length == 0 || !ehD.conf['number-real-index']) {
				var len = imageList.length.toString().length + 1,
					padding = new Array(len + 1).join('0');
				imageList.forEach(function (elem, index) {
					return elem.imageNumber = (padding + (index + 1)).slice(0 - len);
				});
			} else {
				var len = pageURLsList.length.toString().length + 1,
					padding = new Array(len + 1).join('0');
				for (var elem in imageList) elem.imageNumber = (padding + (elem.realIndex)).slice(0 - len);
			}
		}
		pushDialog('\n');
		ehD.DOM.dialog.appendChild(progressTable);
		retryCount = [];
		fetchImg.addThreads();
	});
	pushDialog('Start downloading at ' + new Date() + '\nStart fetching images\' URL...\nFetching Page 1: ' + fetchURL + ' ... ');
})