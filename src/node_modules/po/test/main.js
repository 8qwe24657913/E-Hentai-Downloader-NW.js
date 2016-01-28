/*!
 * 文件描述
 * @author ydr.me
 * @create 2015-05-04 02:46
 */


'use strict';

var co = require('co');
var fs = require('fs');
var path = require('path');
var expect = require('chai').expect;
var po = require('../index.js');

describe('main', function () {
    it('fs.stat exist file', function (done) {
        var fsStat = po(fs.stat, fs);

        co(function* () {
            return yield fsStat(path.join(__dirname, './main.js'));
        }).then(function (stat) {
            expect(stat).to.not.be.undefined;
            done();
        }).catch(function (err) {
            expect(err).to.be.undefined;
            done();
        });
    });

    it('fs.stat no context', function (done) {
        var fsStat = po(fs.stat);

        co(function* () {
            return yield fsStat(path.join(__dirname, './main.js'));
        }).then(function (stat) {
            expect(stat).to.not.be.undefined;
            done();
        }).catch(function (err) {
            expect(err).to.be.undefined;
            done();
        });
    });

    it('fs.stat not exist fie', function (done) {
        var fsStat = po(fs.stat, fs);

        co(function* () {
            return yield fsStat(path.join(__dirname, './main.js'));
        }).then(function (stat) {
            expect(stat).to.be.undefined;
            done();
        }).catch(function (err) {
            expect(err).to.not.be.undefined;
            done();
        });
    });

    it('fs.stat2 not a function', function (done) {
        var fsStat2 = po(fs.stat2, fs);

        co(function* () {
            return yield fsStat2(path.join(__dirname, './main.js'));
        }).then(function (stat) {
            expect(stat).to.be.undefined;
            done();
        }).catch(function (err) {
            expect(err).to.not.be.undefined;
            done();
        });
    });
});