//
// ============== JuNe BackServer 2.1.1 (Simplified) ===============
//
// Copyright (c) 2024 Eduardo Ruiz <eruiz@dataclick.es>
// https://github.com/EduardoRuizM/june-backserver
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const EventEmitter = require('events');

class BackServer extends EventEmitter {
  constructor(options) {
    super();
    this.server = 0;
    options = options ?? {};
    this.url = new URL(options.url ?? 'http://localhost:8180');
    this.ipv6 = options.ipv6 ?? true;
    this.cert = options.cert;
    this.key = options.key;
    this.cert_dt = 0;
    this.before = options.before;
    this.after = options.after;
    this.cors = options.cors ?? '*';
    this.req = 0;
    this.maxBodySize = options.maxBodySize ?? 1048576; // 1MB default
    this.messages = options.messages ?? {missing: 'Missing fields'};
    this.routes = {get: [], post: [], put: []};
  }
  get(route, func) {
    this.routes.get.push({route: route, func: func});
  }
  post(route, func) {
    this.routes.post.push({route: route, func: func});
  }
  put(route, func) {
    this.routes.put.push({route: route, func: func});
  }
  createServer() {
    this.cert_dt = (this.cert && fs.existsSync(this.cert) && this.url.protocol === 'https:') ? fs.statSync(this.cert).mtime : 0;
    this.server = ((this.cert_dt) ? https.createServer({cert: fs.readFileSync(this.cert), key: fs.readFileSync(this.key)}) : http.createServer())
      .on('listening', () => this.emit('listening', this.server.address()))
      .on('request', (req, res) => this.request(req, res))
      .on('error', err => this.emit('error', err))
      .listen((this.url.port) ? this.url.port : ((this.cert_dt) ? 443 : 80), (this.ipv6) ? '::0' : '0.0.0.0');
  }
  getRoute(m, r) {
    let g, i = this.routes[m]?.findIndex(e => {
      g = r.match(new RegExp('^' + e.route.replace(/:([^/]+)/g, '(?<$1>[^/]+)') + '$'));
      return g;
    });
    return {i: i, g: g};
  }
  checkCert() {
    if(this.cert_dt && fs.existsSync(this.cert) && this.cert_dt !== fs.statSync(this.cert).mtime) {
      this.server.close();
      this.createServer();
    }
  }
  readBody(req, body, j) {
    try {
      if(j)
        req.body = (body) ? JSON.parse(body) : {};
      else {
        let s = body.split('\r\n'), rs = body.split(s[0]);
        for(let r of rs) {
          let l = r.split('\r\n');
          if(!l[1])
            continue;

          let n = l[1].match(/ name="([^"]+)"/);
          if(!n)
            continue;

          n = n[1];
          let v = /^\r\n[^\r]+\r\n(Content\-Type: ([^\r]+)\r\n)*\r\n([\s\S]*)\r\n$/.exec(r);
          if(v[2]) {
            let a = n.slice(-2), fn = l[1].match(/ filename="([^"]+)"/), f = {name: fn[1] ?? '', type: v[2], size: v[3].length, content: v[3]};
            if(a === '[]') {
              n = n.substring(0, n.length - 2);
              if(!req.body[n])
                req.body[n] = [];
              req.body[n].push(f);
            } else
              req.body[n] = f;
          } else
            req.body[n] = v[3];
        }
      }
    } catch(err) {
      console.error(err);
    }
  }
  request(req, res) {
    const { method, url, headers } = req;
    const { pathname, searchParams: query } = new URL(url, 'http://x');

    res.setHeader('Access-Control-Allow-Origin', this.cors);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'Authorization');

    let m = method.toLowerCase(), next = true;
    if(m === 'options') {
      res.writeHead(200, {'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Server': 'JuNe BackServer'});
      res.end();
    } else if(/^get|post|put$/.test(m)) {
      res.sendHeaders = {'Content-Type': 'application/json'};
      let body = Buffer.from('');
      let bodyTooLarge = false;
      req.on('data', c => {
        body = Buffer.concat([body, Buffer.from(c)]);
        if(body.length > this.maxBodySize) {
          bodyTooLarge = true;
          req.destroy();
        }
      });
      req.on('end', async () => {
        if(bodyTooLarge) {
          res.writeHead(413, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: 'Request body too large'}) + '\n');
          return;
        }
        req.status = 200;
        req.getobj = Object.fromEntries(query);
        req.getparams = query;
        req.content = {};
        req.body = {};
        req.ip = req.socket.address().address;
        if(/^post|put$/.test(m))
          this.readBody(req, body.toString('latin1'), !headers['content-type']?.startsWith('multipart/form-data'));

        this.req = req;
        let i = this.getRoute(m, pathname);
        req.params = i.g?.groups;
        if(this.before)
          await this.before(req, res, next);

        if(next) {
          if(i.i === -1) {
            if((i = this.routes.get.findIndex(e => e.route === '(default)')) > -1)
              await this.routes.get[i].func(req, res);
            else
              req.status = 405;
          } else
            await this.routes[m][i.i].func(req, res);
        }

        res.writeHead(req.status, res.sendHeaders);
        res.write((req.raw) ? req.raw : JSON.stringify(req.content) + '\n');

        if(this.after)
          await this.after(req, res);

        res.end();
        this.checkCert();
      });
    }
  }
  checkParams(fields) {
    let v = '';
    for(let i in fields) {
      if(!this.req.body || this.req.body[i] === undefined || this.req.body[i].toString().trim() === '')
        v+= ((v === '') ? '' : ', ') + fields[i];
    }
    if(v) {
      this.req.status = 400;
      this.req.content.message = `${this.messages.missing} ${v}`;
      return false;
    } else
      return true;
  }
}

module.exports = options => new BackServer(options);
