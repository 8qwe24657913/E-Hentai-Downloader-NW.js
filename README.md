# E-Hentai-Downloader-NW.js

Directly Download E-Hentai archive as folder with less memory usage than [The userscript version](https://github.com/ccloli/E-Hentai-Downloader)

![kokomade](https://raw.githubusercontent.com/8qwe24657913/E-Hentai-Downloader-NW.js/v0.13%2B/kokomade.jpg)
Thank you for your company, E-Hentai. [Original Post](https://forums.e-hentai.org/index.php?showtopic=229503)

## This branch requires nw.js v0.13+. If you are an old user, please [update nw.js](http://nwjs.io/downloads/)

## [天朝新司机看这里](https://github.com/8qwe24657913/E-Hentai-Downloader-NW.js/wiki/%E5%A4%A9%E6%9C%9D%E6%96%B0%E5%8F%B8%E6%9C%BA%E7%9C%8B%E8%BF%99%E9%87%8C(For-Chinese-Main-Land-New-Users))(For Chinese Main Land New Users)


## Required Environment

- All Systems that NW.js supports


## Download
- Download [nw.js](http://nwjs.io/downloads/) and [this repo](https://github.com/8qwe24657913/E-Hentai-Downloader-NW.js/archive/v0.13+.zip) and decompress them, then put `package.nw` folder in the same folder as `nw.exe`


## How To Use

1. Paste the E-Hentai Gallery URL into the url box
2. Click "Download Archive"
3. Have a cup of coffee :coffee:
4. Enjoy it!


Tips:
* Check "Number Images" to number download images
* Set "Pages Range" to choose pages you want to download


## Why NW.js?

- With a userscript, images are stored in you RAM, not HDD, this may cause memory problem, even make the file you downloaded broken
- You needn't zip it in the browser and unzip it with your software
- NW.js supports almost all PC systems(On Android you can use [EhViewer](http://www.ehviewer.com)), the userscript version requires specific versions of browsers and extensions
- It's easier to transplant userjs to nwjs than to other programming language



## How It Works

It won't download archive from E-Hentai archive download page, so it won't spend your GPs or credits. It will fetch all the pages of the gallery and get their images' URL. 


## Proxy

EHD-NW.js will use your system proxy if `Assign Proxy` is not checked.
if it's checked, a text input will appear.
- To assign a proxy, fill the text input with `http://host:port` or `https://host:port`
- if the text input is empty, EHD-NW.js won't use any proxy


## Should Be Noticed

- You can have a look at [E-Hentai Image Viewing Limits](https://github.com/8qwe24657913/E-Hentai-Downloader-NW.js/wiki/E%E2%88%92Hentai-Image-Viewing-Limits)
- Most of archive may have a torrent download. You can download archive with torrent to get stable download experience, get bonus content (most in cosplay gallery), earn GP and credit, and reduce the pressure of E-Hentai original servers (though it's a P2P site)


## Browser Developer Tools

To record running progress, script will output some logs into console (Right Click --> Devtools or Press F12 --> Console). If you find a bug, you can copy them and paste them here. But noticed, keep opening developer tools may increase memory usage and reduce running efficiency. So don't open console only if you want to see the output logs.


## Todos

- Make the code tidier (这个真不是我的锅，cc的代码比这还乱……)

## Report A Bug

You can report a bug or give suggestions at [GitHub Issue](https://github.com/8qwe24657913/E-Hentai-Downloader-NW.js/issues). English and Chinese are acceptable :stuck_out_tongue_closed_eyes:
