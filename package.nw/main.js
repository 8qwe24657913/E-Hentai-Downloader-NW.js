'use strict';
var fs = require('fs'),
    http = require('http'),
    https = require('https'),
    url = require('url'),
    stream = require('stream'),
    gui = require('nw.gui'),
    ProxyAgent = require('proxy-agent');

const dialog = document.getElementById('ehD-dialog');

window.addEventListener('dragover', function(e) {
    e.stopPropagation();
    e.preventDefault();
});
window.addEventListener('drop', function(e) {
    e.stopPropagation();
    e.preventDefault();
    for (var file of e.dataTransfer.files) {
        if ('resume.txt' === file.name) {
            dialog.innerHTML = '';
            dialog.classList.remove('hide');
            return ehD.resume(file.path).catch(ERRLOG)
        };
    }
});

function ERRLOG(err) {
    if (err instanceof Error) err = err.stack;
    console.error(err);
}

function FATALERR(err) {
    if (err instanceof Error) err = err.stack;
    console.error(err);
    pushDialog(`Fatal error:\n${err}\nPlease right-click and choose devtools to get detailed information.`);
    throw err;
}

var ehDownloadRegex = {
    nl: /return nl\('([\d-]+)'\)/,
    fileName: /g\/l.png" \/><\/a><\/div><div>([\s\S]+?) :: /,
    resFileName: /filename=['"]?([\s\S]+?)['"]?$/m,
    pagesRange: /^(\d*(-\d*)?\s*?,\s*?)*\d*(-\d*)?$/,
    pagesURL: /(?:<a href=").+?(?=")/gi
};

var globals = {};
var parser = new DOMParser();

const ehD = {
    config_txt: '',
    defConf: {
        cookie: '',
        threadCount: 5,
        timeout: 300,
        retryCount: 3,
        dirName: '{gid}_{token}',
        numberImages: true,
        numberSeparator: '：',
        forceResized: false,
        numberRealIndex: true,
        neverNewUrl: false,
        neverSendNl: false
    },
    getReqOpt(href) {
        var agent, opts = url.parse(href);
        if (vm.proxy) {
            if (vm.proxyUri) agent = new ProxyAgent(vm.proxyUri);
        } else {
            var proxy = gui.App.getProxyForURL(href).split(';')[0].trim();
            if (proxy && proxy !== 'DIRECT') {
                agent = new ProxyAgent(proxy.replace(/^PROXY/, 'HTTP').replace(/^([A-Za-z0-9]+) /, '$1://').toLowerCase());
            }
        }
        if (agent) opts.agent = agent;
        if (!opts.headers) opts.headers = {};
        opts.headers.cookie = vm.cookie;
        return opts;
    },
    get: po(function(href, code, callback) {
        if (!callback) callback = code, code = {};
        const opts = '[object String]' === ({}).toString.call(href) ? ehD.getReqOpt(href) : href;
        var req = (opts.protocol === 'https:' ? https : http).get(opts, function(res) {
            var chunks = [];
            res.on('data', function(chunk) {
                chunks.push(chunk);
            }).on('end', function() {
                return callback(undefined, Buffer.concat(chunks).toString());
            });
            code.res && code.res(res, req);
        });
        code.req && code.req(req);
        req.on('error', callback);
        req.end();
        return req;
    }),
    getPage(getUrl, callback, onfail) {
        var url, request, retryCount = 0,
            successed = true,
            code = {
                req: function(req) {
                    request = req;
                    req.setTimeout(30000, fail);
                },
                res: function(res) {
                    if (res.statusCode !== 200) fail();
                }
            };

        function send() {
            if (successed) url = getUrl();
            if (url) ehD.get(url, code).then(function(result) {
                if (!result) return fail();
                retryCount = 0;
                successed = true;
                try {
                    callback(result, send, fail)
                } catch (e) {
                    ERRLOG(e);
                    fail();
                }
                request = null;
            }, fail).catch(ERRLOG);
        }

        function fail() {
            request && request.abort();
            request = null;
            successed = false;
            if (onfail) {
                try {
                    return onfail(send);
                } catch (e) {
                    return ERRLOG(e);
                }
            }
            if (retryCount < vm.retryCount) {
                pushDialog('Failed! Retrying... ');
                retryCount++;
                send();
            } else {
                pushDialog('Failed!\nFetch images\' URL failed, Please try again later.');
            }
        }
        send();
    },
    setData(data) {
        if (!data) {
            for (let [key, value] of Object.entries(this.defConf)) vm[key] = value;
            return;
        }
        const conf = {};
        for (let [key, value] of Object.entries(data)) {
            if (/-[a-z]/.test(key)) key = key.replace(/-([a-z])/g, (match, chr) => chr.toUpperCase()); // 'camel-case' to 'camelCase'
            conf[key] = value;
        }
        if (conf.hasOwnProperty('numberSeparator')) conf.numberSeparator = getPurifiedName(String(conf.numberSeparator));
        for (let [key, value] of Object.entries(this.defConf)) {
            if (conf.hasOwnProperty(key)) {
                if (value.constructor === conf[key].constructor) {
                    value = conf[key];
                } else {
                    try {
                        value = value.constructor(conf[key]);
                    } catch (e) {}
                }
            }
            vm[key] = value;
        }
    },
    win: gui.Window.get(),
    regEvents() {
        document.addEventListener('keyup', e => {
            if (27 === e.keyCode) this.win.close(); // ESC
        });
        this.win.on('close', function() {
            const close = () => (this.close(true), process.exit(0));
            if (isDownloadingImg) {
                if (confirm('E-Hentai Downloader is still running. Do you still want to suspend downloading?')) {
                    this.hide();
                    fetchImg.suspend().then(close, close);
                }
            } else close();
        });
    },
    async writeConf(conf) {
        const config = JSON.stringify(conf, null, '\t');
        if (config === this.config_txt) return;
        try {
            await this.writeFile('config.json', config, 'utf8');
            this.config_txt = config;
        } catch (e) {
            ERRLOG(e);
        }
    },
    async resume(path) {
        var txt = await this.readFile(path, 'utf8');
        [vm.url, vm.range] = txt.split('\r\n', 2);
        await ehD.parseGlobals(vm.url).catch(FATALERR);
        isResume = true;
        pushDialog('\nResume fetching images.\n');
        dirName = getReplacedName(vm.dirName) + '/';
        return getAllPagesURL();
    },
    async init() {
        this.regEvents();
        try {
            const txt = await this.readFile('config.json', 'utf8'),
                conf = JSON.parse(txt);
            this.config_txt = txt;
            this.setData(conf);
        } catch (e) {
            console.warn('config.json is missing or broken, error message:', e, 'trying applying default config.');
            this.writeConf(this.defConf);
            this.setData(null);
        }
    },
    async parseGlobals(url) {
        url = url.split('?', 1)[0]; // always load the first page
        pushDialog('Parsing: ' + url + '\n');
        if (globals.url === url) return globals;
        var e, txt = await ehD.get(url);
        globals = {
            url,
            origin: url.match(/^[^\/]+\/\/[^\/]+/)[0],
            isREH: false
        };
        // r.e-hentai.org points all links to g.e-hentai.org
        if (globals.origin.includes('r.e-hentai.org')) {
            globals.origin = globals.origin.replace(/r\.e-hentai\.org/, 'g.e-hentai.org');
            globals.isREH = true;
        };
        // regex
        var _origin = globals.origin.split('.').join('\\.');
        Object.assign(ehDownloadRegex, {
            imageURL: [
                RegExp('<a href="(' + _origin + '\/fullimg\\.php\\?\\S+?)"'),
                /<img id="img" src="(\S+?)"/,
                /<\/(?:script|iframe)><a[\s\S]+?><img src="(\S+?)"/ // Sometimes preview image may not have id="img"
            ],
            nextFetchURL: [
                RegExp('<a id="next"[\\s\\S]+?href="(' + _origin + '\\/s\\/\\S+?)"'),
                RegExp('<a href="(' + _origin + '\\/s\\/\\S+?)"><img src="http://ehgt.org/g/n.png"')
            ]
        });
        console.log('Start parsing:', url);
        const doc = parser.parseFromString(txt, 'text/html');
        // js variables
        console.log('Parsing:', 'js variables');
        const context = {},
            code = [].map.call(doc.getElementsByTagName('script'), elem => elem.textContent).find(code => code.includes('var gid'));
        require('vm').runInNewContext(code, context);
        for (let key of ['gid', 'token', 'apiuid', 'average_rating']) globals[key] = context[key];
        // gallery information
        console.log('Parsing:', 'gallery information');
        const galleryInfo = {
            title: doc.getElementById('gn').textContent,
            subtitle: doc.getElementById('gj').textContent,
            tag: doc.querySelector('.ic').getAttribute('alt') /*.toUpperCase()*/ ,
            uploader: doc.querySelector('#gdn a').textContent
        };
        for (let [key, value] of Object.entries(galleryInfo)) globals[key] = getPurifiedName(value);
        if (!globals.subtitle) globals.subtitle = globals.title;
        // description
        console.log('Parsing:', 'description');
        globals.description = [].map.call(doc.querySelectorAll('#gdd tr'), elem => elem.textContent.trim().replace(/:/, ': ').replaceHTMLEntites());
        // page num
        console.log('Parsing:', 'page num');
        globals.pageNum = Math.max(1, ...[].map.call(doc.querySelectorAll('.ptt td'), elem => (Number(elem.textContent) || 1)));
        // first url
        console.log('Parsing:', 'first url');
        globals.firstUrl = doc.querySelector('#gdt img').parentElement.href.replaceOrigin();
        // uploader comment
        console.log('Parsing:', 'uploader comment');
        const comment_0 = doc.getElementById('comment_0');
        if (comment_0) globals.uploaderComment = comment_0.innerHTML.replace(/<br[^>]*>/gi, '\n')
        // tags
        globals.tags = [].map.call(doc.querySelectorAll('#taglist tr'), function(elem) {
            var tds = elem.getElementsByTagName('td');
            return '> ' + tds[0].textContent + ' ' + [].map.call(tds[1].querySelectorAll('a'), elem => elem.textContent).join(', ');
        });
        console.log('Finished parsing.');
        return globals
    }
};
['mkdir', 'readFile', 'stat', 'unlink', 'writeFile'].forEach(key => ehD[key] = po(fs[key], fs));

var vm = new Vue({
    el: '#ehD',
    data: Object.assign({
        url: '',
        range: '',
        proxy: false,
        proxyUri: ''
    }, ehD.defConf),
    methods: {
        async start() {
            isResume = false;
            this.save(); // auto save
            dialog.innerHTML = '';
            dialog.classList.remove('hide');
            await ehD.parseGlobals(vm.url).catch(FATALERR);
            if (globals.apiuid === -1 && !confirm('You are not log in to E-Hentai Forums, so you can\'t download original image. Continue?')) return dialog.classList.add('hide');
            dirName = getReplacedName(vm.dirName) + '/';
            // check dir
            try {
                var stat = await ehD.stat(dirName);
            } catch (e) {
                if (-4058 !== e.errno) return FATALERR(e); // ENOENT
                await ehD.mkdir(dirName).catch(FATALERR);
            }
            if (!stat.isDirectory()) {
                if (confirm('There is a file whose name is duplicated with dirName. Do you want to unlink it?')) {
                    await ehD.unlink(dirName).catch(FATALERR);
                    await ehD.mkdir(dirName).catch(FATALERR);
                } else return FATALERR('Same-name file didn\'t removed!');
            } else {
                try {
                    var resumeStat = await ehD.stat(dirName + 'resume.txt');
                    if (!resumeStat.isDirectory()) {
                        return ehD.resume(dirName + 'resume.txt').catch(FATALERR);
                    }
                } catch (e) {}
            }
            // start
            if (vm.range === '') {
                if (pagesRange.length) pagesRange = [];
                ehDownload();
            } else getAllPagesURL();
        },
        async save() {
            const conf = {};
            for (let key of Object.keys(ehD.defConf)) conf[key] = vm[key];
            ehD.writeConf(conf);
        },
        cancel() {
            ehD.setData(null);
        },
        exit() {
            ehD.win.close();
        }
    },
    computed: {
        "numberSeparatorRaw": {
            get() {
                return this.numberSeparator;
            },
            set(newValue) {
                this.numberSeparator = getPurifiedName(newValue) || '：';
            }
        },
        "dirNameRaw": {
            get() {
                return this.dirName;
            },
            set(newValue) {
                this.dirName = newValue || '{gid}_{token}';
            }
        },
        "threadCountRaw": {
            get() {
                return this.threadCount;
            },
            set(newValue) {
                this.threadCount = newValue || 1;
            }
        }
    }
});

ehD.init().catch(ERRLOG);

// ==========---------- Main Function Starts Here ----------========== //
var retryCount = 0;
var imageList = [];
var imageData = [];
var logStr = '';
var fetchCount = 0;
var downloadedCount = 0;
var fetchThread = [];
var dirName;
var failedCount = 0;
var progressTable = null;
var pagesRange = [];
var isDownloadingImg = false;
var isResume = false;
var pageURLsList = [];
var getAllPagesURLFin = false;

// https://stackoverflow.com/a/3700369
String.prototype.replaceHTMLEntites = function() {
    var txt = document.createElement('textarea');
    txt.innerHTML = this;
    return txt.value;
};

// Fixed cross origin in r.e-hentai.org
// 发现 prototype 好方便 _(:3
// Added By 8qwe24657913: 然后你就会发现只要一for in就必须hasOwnProperty……
String.prototype.replaceOrigin = function() {
    return globals.isREH ? this.replace('g.e-hentai.org', 'r.e-hentai.org') : this.toString();
};

function pushDialog(str) {
    if (typeof str === 'string') dialog.insertAdjacentHTML('beforeend', str.replace(/\n/gi, '<br>'));
    else dialog.appendChild(str);
    dialog.scrollTop = dialog.scrollHeight;
}

function getReplacedName(str) {
    return str.replace(/{(gid|token|title|subtitle|tag|uploader)}/gi, function(match, name) {
        return globals[name]
    }).replaceHTMLEntites();
}

function getPurifiedName(name) { // 半角与全角charCode相差65248
    return name.trim().replace(/[:"'*?|<>\/\\\n]/g, chr => String.fromCharCode(chr.charCodeAt(0) + 65248)).replace(/\n/g, '-');
}

var fileNames = {};

function getUniqueFileName(pageData) {
    var oriName = pageData.imageName;
    if (vm.numberImages) return pageData.imageName = pageData.imageNumber + vm.numberSeparator + oriName;
    var name = oriName.toLowerCase();
    if (!fileNames[name]) return (fileNames[name] = 1, oriName);
    var index = name.lastIndexOf('.'),
        prefix = name.substr(0, index),
        suffix = name.substr(index),
        count = 1;
    while (fileNames[name = prefix + (++count) + suffix]);
    fileNames[name] = 1;
    return pageData.imageName = oriName.substr(0, index) + count + oriName.substr(index);
}

function PageData(pageURL, imageURL, imageName, nextNL, realIndex) {
    this.pageURL = pageURL.split('?')[0];
    this.imageURL = imageURL;
    this.imageName = getPurifiedName(imageName);
    this.nextNL = nextNL;
    this.realIndex = realIndex;
    this.imageNumber = '';
}

class Status {
    constructor(image) {
        var node = this.self = document.createElement('tr');
        node.innerHTML = `
			<td class="ehD-pt-name">#${image.realIndex}: ${image.imageName}</td>
			<td class="ehD-pt-progress-outer">
				<progress class="ehD-pt-progress"></progress>
				<span class="ehD-pt-progress-text"></span>
			</td>
			<td class="ehD-pt-status">Pending...</td>`;
        Object.assign(this, {
            fileName: node.getElementsByTagName('td')[0],
            status: node.getElementsByTagName('td')[2],
            progress: node.getElementsByTagName('progress')[0],
            progressText: node.getElementsByTagName('span')[0]
        });
        progressTable.appendChild(node);
    }
    set(data) {
        if (!data) return this;
        if ('class' in data) this.self.className = 'ehD-pt-item ' + data.class.trim();
        if ('progress' in data) this.progress.setAttribute('value', data.progress);
        for (var name of ['status', 'progressText', 'fileName'])
            if (name in data) this[name].textContent = data[name];
        return this;
    }
}

var fetchImg = {
    run(index, status, url) {
        var image = imageList[index];
        if (!retryCount[index]) retryCount[index] = 0;
        if (!status) status = new Status(imageList[index]);
        if (!url) url = image.imageURL;
        var options = ehD.getReqOpt(url);
        options.headers.referer = options.headers['x-alt-referer'] = image.pageURL;
        options.method = 'GET';
        var speedInfo = {
            lastTimestamp: new Date().getTime(),
            lastProgress: 0,
            loaded: 0,
            total: 0
        };
        var req = (options.protocol === 'https:' ? https : http).request(options, function(res) {
            function fail(a, b, c) {
                fetchImg.fail(a, b, c, index, status, res);
            }
            if (res.statusCode !== 200) {
                req.abort();
                switch (res.statusCode) {
                    case 301:
                        image.imageURL = res.headers.location;
                    case 302:
                        fetchImg.run(index, status, res.headers.location);
                        break;
                    case 403:
                        fail('403 Access Denied', 'Error 403', 1);
                        break;
                    case 500:
                        fail('500 Internal Server Error.(See: <a href="https://github.com/ccloli/E-Hentai-Downloader/issues/16">here</a> )', 'Error 500', 0);
                        break;
                    case 509:
                        fetchImg.reachedLimits(true, index, status, res);
                    default:
                        fail('Wrong Response Status (See: <a href="https://github.com/ccloli/E-Hentai-Downloader/issues/16">here</a> )', 'Wrong Status', 0);
                }
                return;
            }
            if (!res.headers['content-type'] || res.headers['content-type'].split('/')[0].trim() !== 'image') {
                req.abort();
                return fail('Wrong Content-Type', 'Wrong MIME', 0);
            }
            fail = null;
            var matches = res.rawHeaders.join('\n').match(ehDownloadRegex.resFileName);
            if (matches) image.imageName = getPurifiedName(matches[1]);
            var path = dirName + getUniqueFileName(image);
            speedInfo.total = res.headers['content-length'];
            fetchImg.listenAndPipe(res, fs.createWriteStream(path, 'binary'), speedInfo.total ? function(chunk) {
                speedInfo.loaded += chunk.length;
                var t = new Date().getTime(),
                    minus = t - speedInfo.lastTimestamp,
                    changes = {
                        progress: speedInfo.loaded / speedInfo.total
                    };
                if (minus >= 1000) {
                    changes.progressText = Number(speedInfo.lastProgress / minus / 1.024).toFixed(2) + ' KB/s';
                    speedInfo.lastTimestamp = t;
                    speedInfo.lastProgress = speedInfo.loaded;
                }
                status.set(changes);
            } : function(chunk) {
                speedInfo.loaded += chunk.length;
            });
            res.on('end', function() {
                fetchImg.onload(res, path, index, status, speedInfo);
            });
            status.set({
                status: retryCount[index] === 0 ? 'Downloading...' : 'Retrying (' + retryCount[index] + '/' + vm.retryCount + ') ...',
                class: ''
            });
        });
        if (0 !== vm.timeout) req.setTimeout(vm.timeout * 1000, function() {
            req.abort();
            return fetchImg.ontimeout(index, status);
        });
        req.on('error', function(e) {
            return fetchImg.onerror(e, index, status);
        });
        req.end();
        fetchThread[index] = req;
    },
    listenAndPipe(from, to, listener) {
        var transform = new stream.Transform();
        transform._transform = function(data, encoding, callback) {
            listener(data);
            callback(null, data);
        }
        return from.pipe(transform).pipe(to);
    },
    fail(str1, str2, retryType, index, status, res, path) { //retryType 0: retry, 1: stop, 2: stopAll
        if (!isDownloadingImg) return;
        console.log('[EHD] #' + (index + 1) + ': ' + str1);
        res && console.log('[EHD] #' + (index + 1) + ': RealIndex >', imageList[index].realIndex, ' | Status >', res.statusCode, ' | StatusText >', res.statusMessage + '\nResposeHeaders >' + res.headers);
        status.set({
            progress: 0,
            progressText: '',
            status: 'Failed! (' + str2 + ')',
            class: retryType ? 'ehD-pt-failed' : 'ehD-pt-warning'
        });
        if (!retryType) return path ? ehD.unlink(path).then(this.retry.bind(this, index, status)).catch(ERRLOG) : this.retry(index, status);
        else if (2 === retryType) return this.abortAll();
        fetchCount--;
        retryCount[index] = 1 / 0;
    },
    retry(index, status) {
        var image = imageList[index];
        fetchThread[index].abort();
        console.error('[EHD] Index >', (index + 1), ' | RealIndex >', image.realIndex, ' | Name >', image.imageName, ' | RetryCount >', retryCount[index], ' | DownloadedCount >', downloadedCount, ' | FetchCount >', fetchCount, ' | FailedCount >', failedCount);
        if (retryCount[index] < vm.retryCount) { //retry
            retryCount[index]++;
            this.run(index, status);
        } else { //fail
            status.set({
                class: 'ehD-pt-failed'
            });
            failedCount++;
            fetchCount--;
            return this.needRetryAll() || this.isFinished();
        }
    },
    addContinueButton() {
        var continueButton = document.createElement('button');
        continueButton.innerHTML = 'Continue Downloading';
        continueButton.addEventListener('click', function() {
            fetchCount = 0;
            dialog.removeChild(continueButton);
            fetchImg.addThreads();
        });
        return dialog.appendChild(continueButton);
    },
    addExitButton() {
        var button = document.createElement('button');
        button.innerHTML = 'Exit';
        button.addEventListener('click', ehD.exit);
        dialog.appendChild(button);
        button = document.createElement('button');
        button.innerHTML = 'Back';
        button.addEventListener('click', function() {
            ehD.win.reload()
        });
        return dialog.appendChild(button);
    },
    addThreads() {
        isDownloadingImg = true;
        for (var status, i = fetchCount, j = 0; i < vm.threadCount; i++) {
            for (; j < imageList.length; j++) {
                if (imageData[j]) continue;
                if (retryCount[j] === vm.retryCount) {
                    imageData[j] = 'Failed';
                    console.log('[EHD] #' + (j + 1) + 'reached retry count!');
                    continue;
                }
                imageData[j] = 'Fetching';
                dialog.scrollTop = dialog.scrollHeight;
                fetchCount++;
                fetchImg.run(j);
                break;
            }
        }
    },
    suspend() {
        this.abortAll();
        for (var arr = [], index = 0; index < imageList.length; index++) {
            if ('Fetched' !== imageData[index]) arr.push(index + 1);
        }
        return ehD.writeFile(dirName + 'resume.txt', globals.url + '\r\n' + arr.join(), 'utf8').then(fetchImg.addExitButton).catch(ERRLOG);
    },
    writeInfo() {
        isDownloadingImg = false;
        for (var elem of imageList) logStr += '\n\nPage ' + elem.realIndex + ': ' + elem.pageURL + '\nImage ' + elem.realIndex + ': ' + elem.imageName /*+ '\nImage URL: ' + elem.imageURL*/ ; // Image URL may useless, see https://github.com/ccloli/E-Hentai-Downloader/issues/6
        pushDialog('\n\nFinish downloading at ' + new Date());
        logStr += '\n\nFinish downloading at ' + new Date() + '\n\nGenerated by E-Hentai Downloader for NW.js(https://github.com/8qwe24657913/E-Hentai-Downloader-NW.js). Thanks to E-Hentai Downloader(https://github.com/ccloli/E-Hentai-Downloader)';
        isResume && ehD.unlink(dirName + 'resume.txt').catch(ERRLOG);
        return ehD.writeFile(dirName + 'info.txt', logStr.replace(/\n/gi, '\r\n'), 'utf8').then(fetchImg.addExitButton).catch(ERRLOG);
    },
    abortAll() {
        isDownloadingImg = false;
        for (var thread of fetchThread) thread.abort();
        fetchCount = 0;
    },
    reachedLimits(isTemp, index, status, res, path) {
        var str = 'You have ' + (isTemp ? 'temporarily ' : '') + 'reached your image viewing limits.';
        fail(isTemp ? '509 Bandwidth Exceeded' : 'Exceed Image Viewing Limits', isTemp ? 'Error 509' : 'Exceed Limits', 2, index, status, res, path);
        if (-1 === globals.apiuid || !confirm(str + ' ' + (isTemp ? 'You can Run the Hentai@Home to support E-Hentai and get more points to increase your limit. Check back in a few hours, and you will be able to download more.' : 'You can reset these limits at home page.') + '\n\nYou can try reseting your image viewing limits to continue by paying your GPs. Reset now?')) {
            this.suspend();
            pushDialog(str);
        } else {
            pushDialog('Please reset your viewing limits at http://g.e-hentai.org/home.php in your browser.\nAfter reseting your viewing limits, click the button below to continue.\n');
            return addContinueButton();
        }
        return isDownloadingImg = false;
    },
    onload(res, path, index, status, speedInfo) {
        if (!isDownloadingImg) return;

        function fail(a, b, c) {
            return fetchImg.fail(a, b, c, index, status, res, path)
        };

        function reachedLimits(a) {
            return fetchImg.reachedLimits(a, index, status, res, path)
        };
        switch (speedInfo.loaded) {
            case 0: // Empty
                return fail('Empty Response (See: <a href="https://github.com/ccloli/E-Hentai-Downloader/issues/16">here</a> )', 'Empty Response');
            case 925: // '403 Access Denied' Image Byte Size
                return fail('403 Access Denied', 'Error 403', 1);
            case 28: // 'An error has occurred. (403)' Length
                return fail('An error has occurred. (403)', 'Error 403');
            case 141: // Image Viewing Limits String Byte Size
                return reachedLimits(false);
            case 28658: // '509 Bandwidth Exceeded' Image Byte Size
                return reachedLimits(true);
        }
        status.set({
            fileName: '#' + imageList[index].realIndex + ': ' + imageList[index].imageName,
            progress: 1,
            progressText: '100%',
            status: 'Succeed!',
            class: 'ehD-pt-succeed'
        });
        imageData[index] = 'Fetched';
        downloadedCount++;
        console.log('[EHD] Index >', index, ' | RealIndex >', imageList[index].realIndex, ' | Name >', imageList[index].imageName, ' | RetryCount >', retryCount[index], ' | DownloadedCount >', downloadedCount, ' | FetchCount >', fetchCount, ' | FailedCount >', failedCount);
        fetchCount--;
        if (!this.isFinished()) return;
        if (failedCount > 0) return this.needRetryAll(); // all files are called to download and some files can't be downloaded
        else return this.writeInfo(); // all files are downloaded successfully
    },
    onerror(e, index, status) {
        return this.fail('Network Error', e, 0, index, status);
    },
    ontimeout(index, status) {
        return this.fail('Timed Out', 'Timed Out', 0, index, status);
    },
    isFinished() {
        if (downloadedCount + failedCount < imageList.length) this.addThreads() // download not finished, some files are not being called to download
        else return 1;
    },
    needRetryAll() {
        if (!isDownloadingImg) return;
        if (fetchCount !== 0) return;
        // all files are finished downloading
        if (confirm('Some images were failed to download. Would you like to try them again?')) {
            retryAllFailed();
        } else {
            pushDialog('\nFetch images failed.');
            this.suspend();
            pushDialog('Fetch images failed, Please try again later.');
            isDownloadingImg = false;
        }
        return true;
    }
};

function retryAllFailed() {
    function startFetchingImg() {
        dialog.appendChild(progressTable);
        fetchImg.addThreads();
    }
    var index, refetch = 0;
    progressTable = document.createElement('table');
    progressTable.style.width = '100%';
    for (index = 0; index < imageData.length; index++) {
        if ('Fetched' !== imageData[index]) {
            imageData[index] = null;
            retryCount[index] = 0;
        }
    }
    if (!vm.neverNewUrl) {
        var fetchURL, index = 0;
        ehD.getPage(function() {
            for (; index < imageData.length; index++) {
                if (imageData[index] != null) continue;
                var image = imageList[index];
                if (!image.imageURL.includes('fullimg.php')) {
                    image.pageURL = fetchURL = (image.pageURL + ((!vm.neverSendNl && image.nextNL) ? (image.pageURL.includes('?') ? '&' : '?') + 'nl=' + image.nextNL : '')).replaceHTMLEntites();
                    pushDialog('Fetching Page ' + (index + 1) + ': ' + fetchURL + ' ... ');
                    refetch = 1;
                    return fetchURL;
                } else failedCount--;
            }
            return fetchURL;
        }, function(result, send, fail) {
            var image = imageList[index];
            if (!image) return;
            var imageURL = (globals.apiuid !== -1 && result.includes('fullimg.php') && !vm.forceResized) ? result.match(ehDownloadRegex.imageURL[0])[1].replaceHTMLEntites() : result.includes('id="img"') ? result.match(ehDownloadRegex.imageURL[1])[1].replaceHTMLEntites() : result.match(ehDownloadRegex.imageURL[2])[1].replaceHTMLEntites(); // Sometimes preview image may not have id="img"
            image.imageURL = imageURL;
            var nextNL = ehDownloadRegex.nl.test(result) ? result.match(ehDownloadRegex.nl)[1] : null;
            image.nextNL = nextNL;
            failedCount--;
            pushDialog('Succeed!\nImage ' + (index + 1) + ': ' + imageURL + '\n');
            if (failedCount === 0) startFetchingImg();
            else {
                ++index;
                send();
            }
        }, function(send) {
            if (retryCount < vm.retryCount) {
                pushDialog('Failed! Retrying... ');
                retryCount++;
                send();
            } else {
                pushDialog('Failed! Skip and continue...');
                refetch = 0;
                ++index;
                send();
                if (!refetch) startFetchingImg();
            }
        });
    }
    if (!refetch) startFetchingImg();
}

function getAllPagesURL() {
    pagesRange = [];
    var pagesRangeText = vm.range.replace(/，/g, ',');
    console.log('[EHD] Pages Range >', pagesRangeText);
    if (!ehDownloadRegex.pagesRange.test(pagesRangeText)) {
        dialog.classList.add('hide');
        return alert('Pages Range is not correct.');
    }
    var pagesRangeScale = pagesRangeText.match(/\d*-\d*|\d+/g);
    pagesRangeScale.forEach(function(elem) {
        if (!elem.includes('-')) {
            var curElem = Number(elem);
            if (!pagesRange.some(function(e) {
                    return curElem === e;
                })) pagesRange.push(curElem);
        } else {
            let start = Number(elem.split('-')[0] || 1),
                end = Number(elem.split('-')[1]) || globals.pageNum;
            [start, end] = [start, end].sort();
            for (var i = start; i <= end; i++) {
                if (!pagesRange.some(function(e) {
                        return i === e;
                    })) pagesRange.push(i);
            }
        }
    });
    pagesRange.sort(function(a, b) {
        return a > b ? 1 : -1;
    });
    if (!getAllPagesURLFin) {
        pageURLsList = [];
        var pagesCount = globals.pageNum;
        var curPage = 0;
        var prefix = globals.url;
        ehD.getPage(function() {
            return prefix + '?p=' + curPage
        }, function(result, send, fail) {
            var pagesURL = result.split('<div id="gdt">')[1].split('<div class="c">')[0].match(ehDownloadRegex.pagesURL);
            for (var i = 0; i < pagesURL.length; i++) {
                pageURLsList.push(pagesURL[i].split('"')[1].replaceHTMLEntites().replaceOrigin());
            }
            pushDialog('Succeed!');
            curPage++;
            if (curPage === pagesCount) {
                getAllPagesURLFin = true;
                checkWrongPages();
                pushDialog('\n\n');
                ehDownload();
            } else {
                send();
                pushDialog('\nFetching Archive Pages URL (' + (curPage + 1) + '/' + pagesCount + ') ... ');
            }
        });
        pushDialog('\nFetching Archive Pages URL (' + (curPage + 1) + '/' + pagesCount + ') ... ');
    } else {
        checkWrongPages();
        ehDownload();
    }

    function checkWrongPages() {
        var wrongPages = pagesRange.filter(function(elem) {
            return elem > pageURLsList.length;
        });
        if (wrongPages.length !== 0) {
            pagesRange = pagesRange.filter(function(elem) {
                return elem <= pageURLsList.length;
            });
            pushDialog('Page ' + wrongPages.join(', ') + (wrongPages.length > 1 ? ' are' : ' is') + ' not exist, and will be ignored.');
        }
    }
}

function ehDownload() {
    imageList = [];
    imageData = [];
    fetchThread = [];
    fetchImg.abortAll();
    var index = 1;
    downloadedCount = fetchCount = failedCount = 0;
    logStr = globals.title + '\n' + (globals.title === globals.subtitle) ? '' : (globals.subtitle + '\n') + globals.url.replaceHTMLEntites() + '\n\n' + 'Category: ' + globals.tag + '\n' + 'Uploader: ' + globals.uploader + '\n';
    logStr += globals.description.join('\n') + '\n'
    logStr += 'Rating: ' + globals.average_rating + '\n';
    logStr += 'Tags:\n' + globals.tags.join('\n') + '\n'
    if (globals.uploaderComment) logStr += 'Uploader Comment:\n' + globals.uploaderComment + '\n';
    logStr += '\n'
    progressTable = document.createElement('table');
    progressTable.style.width = '100%';
    pushDialog(logStr);
    var fetchURL;
    if (getAllPagesURLFin) {
        var rangeIndex = 0;
        if (pagesRange.length === 0) fetchURL = pageURLsList[rangeIndex];
        else fetchURL = pageURLsList[pagesRange[rangeIndex] - 1];
    } else {
        pageURLsList = [];
        fetchURL = globals.firstUrl;
    }
    ehD.getPage(function() {
        return fetchURL;
    }, function(result, send, fail) {
        var realIndex = (pagesRange.length !== 0 ? pagesRange[Math.min(rangeIndex, pagesRange.length - 1)] : index);
        if (getAllPagesURLFin) {
            rangeIndex++;
            if (pagesRange.length === 0) var nextFetchURL = pageURLsList[Math.min(rangeIndex, pageURLsList.length - 1)];
            else var nextFetchURL = pageURLsList[pagesRange[Math.min(rangeIndex, pagesRange.length - 1)] - 1];
        } else {
            pageURLsList.push(fetchURL);
            var nextFetchURL = result.includes('<a id="next"') ? result.match(ehDownloadRegex.nextFetchURL[0])[1].replaceHTMLEntites().replaceOrigin() : result.match(ehDownloadRegex.nextFetchURL[1])[1].replaceHTMLEntites().replaceOrigin();
        }
        var imageURL = (globals.apiuid !== -1 && result.includes('fullimg.php') && !vm.forceResized) ? result.match(ehDownloadRegex.imageURL[0])[1].replaceHTMLEntites().replaceOrigin() : result.includes('id="img"') ? result.match(ehDownloadRegex.imageURL[1])[1].replaceHTMLEntites() : result.match(ehDownloadRegex.imageURL[2])[1].replaceHTMLEntites(); // Sometimes preview image may not have id="img"
        var fileName = result.match(ehDownloadRegex.fileName)[1].replaceHTMLEntites();
        var nextNL = ehDownloadRegex.nl.test(result) ? result.match(ehDownloadRegex.nl)[1] : null;
        imageList.push(new PageData(fetchURL, imageURL, fileName, nextNL, realIndex));
        index++;
        pushDialog('Succeed!\nImage ' + realIndex + ': ' + imageURL + '\n');
        if (nextFetchURL !== fetchURL) {
            fetchURL = nextFetchURL;
            pushDialog('Fetching Page ' + (pagesRange.length !== 0 ? pagesRange[Math.min(rangeIndex, pagesRange.length - 1)] : index) + ': ' + fetchURL + ' ... ');
            return send();
        }
        getAllPagesURLFin = true;
        if (vm.numberImages) {
            // Number images, thanks to JingJang@GitHub, source: https://github.com/JingJang/E-Hentai-Downloader
            if (pagesRange.length === 0 || !isResume && !vm.numberRealIndex) {
                let len = Math.ceil(Math.log10(imageList.length));
                for (let [index, elem] of imageList.entries()) elem.imageNumber = String(index + 1).padStart(len, '0');
            } else {
                let len = Math.ceil(Math.log10(pageURLsList.length));
                for (let elem of imageList) elem.imageNumber = String(elem.realIndex).padStart(len, '0');
            }
        }
        pushDialog('\n');
        dialog.appendChild(progressTable);
        retryCount = [];
        fetchImg.addThreads();
    });
    pushDialog('Start downloading at ' + new Date() + '\nStart fetching images\' URL...\nFetching Page 1: ' + fetchURL + ' ... ');
}