'use strict';
var fs = require('fs'),
    http = require('http'),
    https = require('https'),
    url = require('url'),
    stream = require('stream'),
    gui = require('nw.gui');

window.addEventListener('dragover', function(e) {
    e.stopPropagation();
    e.preventDefault();
});
window.addEventListener('drop', function(e) {
    e.stopPropagation();
    e.preventDefault();
    for (var file of e.dataTransfer.files) {
        if ('resume.txt' === file.name) {
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
        var proxy, matches, opts = url.parse(href);
        if (vm.proxy) {
            proxy = vm.proxyUri;
        } else {
            proxy = gui.App.getProxyForURL(href).split(';')[0].trim().toLowerCase().replace(/^proxy /, 'http ').replace(/^(https?) /, '$1://');
        }
        if (proxy && (matches = proxy.match(/^(?<protocol>https?:)\/\/(?<host>[^:]+):(?<port>\d+)/))) {
            const { protocol, host, port } = matches.groups;
            opts = {
                path: href,
                protocol,
                host,
                port,
                headers: {
                    Host: opts.host
                }
            }
        }
        if (!opts.headers) opts.headers = {};
        if (/^(.*\.)?e[x\-]hentai.org$/.test(opts.host)) opts.headers.cookie = vm.cookie;
        return opts;
    },
    get: po(function(href, timeout, callback) {
        if (!callback) callback = timeout, timeout = 0;
        const opts = '[object String]' === ({}).toString.call(href) ? ehD.getReqOpt(href) : href;
        var req = (opts.protocol === 'https:' ? https : http).get(opts, function(res) {
            if (res.statusCode !== 200) callback(`${res.statusCode} ${res.statusMessage}`);
            var chunks = [];
            res.on('data', function(chunk) {
                chunks.push(chunk);
            }).on('end', function() {
                return callback(undefined, Buffer.concat(chunks).toString());
            });
        });
        if (timeout) req.setTimeout(timeout, function() {
            req.abort();
            callback(new Error('Timeout'));
        });
        req.on('error', callback);
        req.end();
        return req;
    }),
    async getPage(url, retryCount = 0) {
        try {
            var result = await ehD.get(url, 30000);
            if (!result) throw new Error('No content');
            //return parser.parseFromString(result, 'text/html');
            return result;
        } catch (err) {
            if (retryCount < vm.retryCount) {
                pushDialog('Failed! Retrying... ');
                retryCount++;
                return ehD.getPage(url, retryCount);
            } else {
                throw err;
            }
        }
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
        proxyUri: '',
        contents: [],
        table: []
    }, ehD.defConf),
    methods: {
        async start() {
            isResume = false;
            this.save(); // auto save
            await ehD.parseGlobals(vm.url).catch(FATALERR);
            if (globals.apiuid === -1 && !confirm('You are not log in to E-Hentai Forums, so you can\'t download original image. Continue?')) return vm.contents = [];
            dirName = getReplacedName(vm.dirName) + '/';
            // check dir
            try {
                var stat = await ehD.stat(dirName);
                if (!stat.isDirectory()) {
                    if (confirm('There is a file whose name is duplicated with dirName. Do you want to unlink it?')) {
                        await ehD.unlink(dirName).catch(FATALERR);
                        await ehD.mkdir(dirName).catch(FATALERR);
                    } else return FATALERR('Same-name file didn\'t removed!');
                } else {
                    try {
                        var resumeStat = await ehD.stat(dirName + 'resume.txt');
                        if (resumeStat.isFile()) {
                            return ehD.resume(dirName + 'resume.txt').catch(FATALERR);
                        }
                    } catch (e) {}
                }
            } catch (e) {
                if (-4058 !== e.errno) return FATALERR(e); // ENOENT
                await ehD.mkdir(dirName).catch(FATALERR);
            }
            pushDialog('Start downloading at ' + new Date() + '\n');
            logStr = globals.title;
            if (globals.title !== globals.subtitle) logStr += '\n' + globals.subtitle;
            logStr += `
${globals.url.replaceHTMLEntites()}

Category: ${globals.tag}
Uploader: ${globals.uploader}
${globals.description.join('\n')}
Tags:
${globals.tags.join('\n')}
`;
            if (globals.uploaderComment) logStr +=
                `Uploader Comment:
${globals.uploaderComment}
`;
            logStr += '\n'
            pushDialog(logStr);
            // start
            getAllPagesURL();
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

(function() {
    function scrollDialogIntoView() {
        const dialog = document.getElementById('ehD-dialog'); // get element every time
        if (dialog && (dialog.clientHeight + dialog.scrollTop < dialog.scrollHeight)) return; // user scrolled up
        vm.$nextTick(function() {
            const dialog = document.getElementById('ehD-dialog'); // get element every time
            dialog.scrollTop = dialog.scrollHeight;
        });
    }
    vm.$watch('contents.length', scrollDialogIntoView);
    vm.$watch('table.length', scrollDialogIntoView);
}());

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
    vm.contents.push(String(str));
}

function getReplacedName(str) {
    return str.replace(/{(gid|token|title|subtitle|tag|uploader)}/gi, function(match, name) {
        return globals[name]
    }).replaceHTMLEntites();
}

function getPurifiedName(name) { // 半角与全角charCode相差65248
    return name.trim().replace(/[:"'*?|<>\/\\]/g, chr => String.fromCharCode(chr.charCodeAt(0) + 65248)).replace(/\n/g, '-');
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

function appendProgressTable() {
    const table = [];
    vm.table = table;
    vm.contents.push(table);
}

class Status {
    constructor(image) {
        this.data = {
            id: vm.id++,
            className: '',
            progress: -1,
            progressText: '',
            status: 'Pending...',
            realIndex: image.realIndex,
            imageName: image.imageName
        };
        vm.table.push(this.data);
    }
    set(data) {
        Object.assign(this.data, data);
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
            lastTimestamp: Date.now(),
            lastProgress: 0,
            loaded: 0,
            total: 0
        };
        var req = (options.protocol === 'https:' ? https : http).request(options, function(res) {
            function fail(desc, shortDesc, retryType) {
                fetchImg.fail(desc, shortDesc, retryType, index, status, res);
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
                        fail('403 Access Denied', 'Error 403', 'abort');
                        break;
                    case 500:
                        fail('500 Internal Server Error.(See: <a href="https://github.com/ccloli/E-Hentai-Downloader/issues/16">here</a> )', 'Error 500', 'retry');
                        break;
                    case 509:
                        fetchImg.reachedLimits(true, index, status, res);
                        break;
                    default:
                        fail('Wrong Response Status (See: <a href="https://github.com/ccloli/E-Hentai-Downloader/issues/16">here</a> )', 'Wrong Status', 'retry');
                }
                return;
            }
            if (!res.headers['content-type'] || res.headers['content-type'].split('/')[0].trim() !== 'image') {
                req.abort();
                return fail('Wrong Content-Type', 'Wrong MIME', 'retry');
            }
            fail = null;
            var matches = res.rawHeaders.join('\n').match(ehDownloadRegex.resFileName);
            if (matches) image.imageName = getPurifiedName(matches[1]);
            var path = dirName + getUniqueFileName(image);
            speedInfo.total = res.headers['content-length'];
            fetchImg.listenAndPipe(res, fs.createWriteStream(path, 'binary'), speedInfo.total ? function(chunk) {
                speedInfo.loaded += chunk.length;
                var t = Date.now(),
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
                status: retryCount[index] === 0 ? 'Downloading...' : `Retrying (${retryCount[index]}/${vm.retryCount}) ...`,
                className: ''
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
    fail(desc, shortDesc, retryType, index, status, res, path) {
        if (!isDownloadingImg) return;
        console.log(`[EHD] #${index + 1}: ${desc}`);
        if (res) console.log(`[EHD] #${index + 1}: RealIndex >`, imageList[index].realIndex, ' | Status >', res.statusCode, ' | StatusText >', res.statusMessage + '\nResposeHeaders >' + res.headers);
        status.set({
            progress: 0,
            progressText: '',
            status: `Failed! (${shortDesc})`,
            className: retryType === 'retry' ? 'ehD-pt-warning' : 'ehD-pt-failed'
        });
        switch (retryType) {
            case 'retry':
                if (path) ehD.unlink(path).then(() => this.retry(index, status)).catch(ERRLOG);
                else this.retry(index, status);
                break;
            case 'abort':
                fetchCount--;
                retryCount[index] = Infinity;
                break;
            case 'abortAll':
                this.abortAll();
                break;
        }
    },
    retry(index, status) {
        var image = imageList[index];
        fetchThread[index].abort();
        console.error('[EHD] Index >', index + 1, ' | RealIndex >', image.realIndex, ' | Name >', image.imageName, ' | RetryCount >', retryCount[index], ' | DownloadedCount >', downloadedCount, ' | FetchCount >', fetchCount, ' | FailedCount >', failedCount);
        if (retryCount[index] < vm.retryCount) { //retry
            retryCount[index]++;
            this.run(index, status);
        } else { //fail
            status.set({
                className: 'ehD-pt-failed'
            });
            failedCount++;
            fetchCount--;
            return this.needRetryAll() || this.isFinished();
        }
    },
    addContinueButton() {
        const index = vm.contents.push({
            text: 'Continue Downloading',
            onclick() {
                fetchCount = 0;
                vm.contents.splice(index, 1);
                fetchImg.addThreads();
            }
        }) - 1;
    },
    addExitButton() {
        vm.contents.push({
            text: 'Exit',
            onclick: vm.exit
        });
        vm.contents.push({
            text: 'Back',
            onclick() {
                ehD.win.removeAllListeners();
                ehD.win.reload();
            }
        });
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
        var str = 'You have ' + (isTemp ? 'temporarily ' : '') + 'reached your image viewing limits. ';
        if (isTemp) {
            this.fail('509 Bandwidth Exceeded', 'Error 509', 'abortAll', index, status, res, path);
            str += 'You can run the Hentai@Home to support E-Hentai and get more points to increase your limit. Check back in a few hours, and you will be able to download more.';
        } else {
            this.fail('Exceed Image Viewing Limits', 'Exceed Limits', 'abortAll', index, status, res, path);
            str += 'You can reset these limits at home page.';
        }
        if (-1 === globals.apiuid || !confirm(str + '\n\nYou can try reseting your image viewing limits to continue by paying your GPs. Reset now?')) {
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

        function fail(desc, shortDesc, retryType) {
            return fetchImg.fail(desc, shortDesc, retryType, index, status, res, path)
        };

        function reachedLimits(isTemp) {
            return fetchImg.reachedLimits(isTemp, index, status, res, path)
        };
        switch (speedInfo.loaded) {
            case 0: // Empty
                return fail('Empty Response (See: <a href="https://github.com/ccloli/E-Hentai-Downloader/issues/16">here</a> )', 'Empty Response', 'retry');
            case 925: // '403 Access Denied' Image Byte Size
                return fail('403 Access Denied', 'Error 403', 'abort');
            case 28: // 'An error has occurred. (403)' Length
                return fail('An error has occurred. (403)', 'Error 403', 'retry');
            case 141: // Image Viewing Limits String Byte Size
                return reachedLimits(false);
            case 28658: // '509 Bandwidth Exceeded' Image Byte Size
                return reachedLimits(true);
        }
        status.set({
            progress: 1,
            progressText: '100%',
            status: 'Succeed!',
            className: 'ehD-pt-succeed'
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
        return this.fail('Network Error', e, 'retry', index, status);
    },
    ontimeout(index, status) {
        return this.fail('Timed Out', 'Timed Out', 'retry', index, status);
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

function getImgUrl(result) {
    if (globals.apiuid !== -1 && result.includes('fullimg.php') && !vm.forceResized) {
        return result.match(ehDownloadRegex.imageURL[0])[1].replaceHTMLEntites()
    } else if (result.includes('id="img"')) {
        return result.match(ehDownloadRegex.imageURL[1])[1].replaceHTMLEntites()
    } else { // Sometimes preview image may not have id="img"
        return result.match(ehDownloadRegex.imageURL[2])[1].replaceHTMLEntites();
    }
}

async function retryAllFailed() {
    for (let [index, status] of imageData.entries()) {
        if (status !== 'Fetched') {
            imageData[index] = null;
            retryCount[index] = 0;
        }
    }
    failedCount = 0;
    if (!vm.neverNewUrl) {
        for (let [index, status] of imageData.entries()) {
            if (status === 'Fetched') continue;
            let image = imageList[index];
            if (image.imageURL.includes('fullimg.php')) continue;
            let fetchURL = image.pageURL = (image.pageURL + ((!vm.neverSendNl && image.nextNL) ? (image.pageURL.includes('?') ? '&' : '?') + 'nl=' + image.nextNL : '')).replaceHTMLEntites();
            pushDialog('Fetching Page ' + (index + 1) + ': ' + fetchURL + ' ... ');
            try {
                var result = await ehD.getPage(fetchURL);
            } catch (e) {
                pushDialog('Failed! Skip and continue...');
                continue;
            }
            var imageURL = getImgUrl(result);
            image.imageURL = imageURL;
            var nextNL = ehDownloadRegex.nl.test(result) ? result.match(ehDownloadRegex.nl)[1] : null;
            image.nextNL = nextNL;
            pushDialog('Succeed!\nImage ' + (index + 1) + ': ' + imageURL + '\n');
        }
    }
    appendProgressTable();
    fetchImg.addThreads();
}

async function getAllPagesURL() {
    var pagesRangeText = vm.range.replace(/，/g, ',') || `1-`;
    console.log('[EHD] Pages Range >', pagesRangeText);
    if (!ehDownloadRegex.pagesRange.test(pagesRangeText)) {
        vm.contents = [];
        return alert('Pages Range is not correct.');
    }
    if (!getAllPagesURLFin) {
        pageURLsList = [];
        var prefix = globals.url;
        for (var curPage = 0, pagesCount = globals.pageNum; curPage < pagesCount; curPage++) {
            pushDialog('\nFetching Archive Pages URL (' + (curPage + 1) + '/' + pagesCount + ') ... ');
            try {
                var result = await ehD.getPage(`${prefix}?p=${curPage}`);
            } catch (e) {
                pushDialog('Failed!\nFetch pages\' URL failed, Please try again later.');
                return;
            }
            var pagesURL = result.split('<div id="gdt">')[1].split('<div class="c">')[0].match(ehDownloadRegex.pagesURL);
            for (var i = 0; i < pagesURL.length; i++) {
                pageURLsList.push(pagesURL[i].split('"')[1].replaceHTMLEntites().replaceOrigin());
            }
            pushDialog('Succeed!');
        }
        getAllPagesURLFin = true;
        pushDialog('\n\n');
    }
    var pagesRangeScale = pagesRangeText.match(/\d*-\d*|\d+/g);
    var numSet = new Set();
    for (let elem of pagesRangeScale) {
        if (!elem.includes('-')) {
            numSet.add(Number(elem));
        } else {
            let [start, end] = elem.split('-').map(Number);
            start = start || 1,
                end = end || pageURLsList.length;
            [start, end] = [start, end].sort((a, b) => a - b);
            for (let num = start; num <= end; num++) numSet.add(num);
        }
    };
    pagesRange = [...numSet].sort((a, b) => a - b);
    // nums in range may greater than pageNum
    var wrongIndex = pagesRange.findIndex(n => n > pageURLsList.length);
    if (wrongIndex !== -1) {
        pagesRange = pagesRange.slice(0, wrongIndex);
        var wrongPages = pagesRange.slice(wrongIndex);
        pushDialog('Page ' + wrongPages.join(', ') + (wrongPages.length > 1 ? ' are' : ' is') + ' not exist, and will be ignored.');
    }
    getImageInfo();
}

async function getImageInfo() {
    pushDialog('Start fetching images\' URL...\n')
    const len = Math.ceil(Math.log10(pagesRange.length));
    for (let [index, realIndex] of pagesRange.entries()) {
        const pageURL = pageURLsList[realIndex - 1];
        pushDialog('Fetching Page ' + realIndex + ': ' + pageURL + ' ... ');
        try {
            var result = await ehD.getPage(pageURL);
        } catch (e) {
            pushDialog('Failed!\nFetch images\' URL failed, Please try again later.');
            return;
        }
        const imageURL = getImgUrl(result);
        const imageName = getPurifiedName(result.match(ehDownloadRegex.fileName)[1].replaceHTMLEntites());
        const nextNL = ehDownloadRegex.nl.test(result) ? result.match(ehDownloadRegex.nl)[1] : null;
        const imageNumber = vm.numberImages ? String(vm.numberRealIndex ? realIndex : index + 1).padStart(len, '0') : '';
        imageList.push({
            pageURL,
            imageURL,
            imageName,
            nextNL,
            realIndex,
            imageNumber
        });
        pushDialog('Succeed!\nImage ' + realIndex + ': ' + imageURL + '\n');
    }
    pushDialog('\n');
    appendProgressTable();
    retryCount = [];
    fetchImg.addThreads();
}
