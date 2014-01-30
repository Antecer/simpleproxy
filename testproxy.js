var net = require('net');
var serverip = "127.0.0.1";
var serverport = 8893;
var connectproxy = 0;
var standalone = 0;

function usage() {
    console.log("usage:");
    console.log("\tnode testproxy.js standalone");
    console.log("\tnode testproxy.js (localhost|remoteIP)");
    console.log("\tnode testproxy.js proxy");
}

if ((process.argv.length < 3) || (process.argv[2] == "--help")) {
    usage();
    return;
}

if (process.argv[2] == "standalone") {
    standalone = 1;
} else if (process.argv[2] == "localhost") {
    connectproxy = 1;
} else if (/^\d+\.\d+\.\d+\.\d+$/.test(process.argv[2])) {
    connectproxy = 1;
    serverip = process.argv[2];
} else if (process.argv[2] == "proxy") {
    serverport += 1;
} else {
    usage();
    return;
}

function encrypt(data) {
    for (var i = 0; i < data.length; i++) {
        data[i] += -1;
    }

    return data;
}

function decrypt(data) {
    for (var i = 0; i < data.length; i++) {
        data[i] -= -1;
    }

    return data;
}

function startService(client, options, cryptfuncs, connopts) {
        //������Ŀ�������������
        var server =  net.createConnection(options);
        var client_closeflag = 0;
        var server_closeflag = 0;

        client.pause();
        server.pause();

        //�����������������������
        client.on("data", function (data) {
            if (!server_closeflag) {
                server.write(cryptfuncs ? cryptfuncs.encrypt(data) : data);
            }
        });

        server.on("data", function (data) {
            if (!client_closeflag) {
                client.write(cryptfuncs ? cryptfuncs.decrypt(data) : data);
            }
        });
          
        client.on("end", function () {
            client_closeflag = 1;
            server.end();
        });
        
        server.on("end", function () {
            server_closeflag = 1;
            client.end();
        });

        client.on("error", function () {
            client_closeflag = 1;
            server.destroy();
        });
        
        server.on("error", function () {
            server_closeflag = 1;
            client.destroy();
        });

        client.on("timeout", function () {
            server.destroy();
            client.destroy();
        });
        
        server.on("timeout", function () {
            server.destroy();
            client.destroy();
        });

        server.on("connect", function (socket) {
            client.resume();
            server.resume();

            if (connopts) {
                connopts.connectfunc(client, server, connopts.req, connopts.buffer);
            }
        });
}

function standAloneConnectAction(client, server, req, buffer) {
    if (req.method == 'CONNECT') {
        client.write(new Buffer("HTTP/1.1 200 Connection established\r\nConnection: close\r\n\r\n"));
    } else {
        server.write(buffer);
    }
}

function proxyConnectAction(client, server, req, buffer) {
    if (req.method == 'CONNECT') {
        client.write(encrypt(new Buffer("HTTP/1.1 200 Connection established\r\nConnection: close\r\n\r\n")));
    } else {
        server.write(buffer);
    }
}

//�ڱ��ش���һ��server��������serverport�˿�
net.createServer({ allowHalfOpen: true}, function (client) {
    if (connectproxy) {
        startService(
            client,
            { allowHalfOpen: true, port: serverport + 1, host: serverip},
            { 'encrypt': encrypt, 'decrypt': decrypt },
            null
        );

        return;
    }

    //���ȼ�������������ݷ����¼���ֱ���յ������ݰ���������http����ͷ
    var buffer = new Buffer(0);
    
    client.on('data', function (data) {
        buffer = buffer_add(buffer, data);

        if (buffer_find_body(buffer) < 0) {
            return;
        }
        
        var req = parse_request(buffer);
        
        if (!req) {
            return;
        }
        
        client.removeAllListeners('data');
        relay_connection(req);
    });
    
    //��http����ͷ��ȡ��������Ϣ�󣬼�������������������ݣ�ͬʱ����Ŀ�������������Ŀ������������ݴ��������
    function relay_connection(req) {
        console.log(req.method + ' ' + req.host + ':' + req.port);

        //���������CONNECT������GET, POST������ô�滻��ͷ����һЩ����
        if (req.method != 'CONNECT') {
            //�ȴ�buffer��ȡ��ͷ��
            var _body_pos = buffer_find_body(buffer);

            if (_body_pos < 0) _body_pos = buffer.length;

            var header = buffer.slice(0, _body_pos).toString('utf8');

            //�滻connectionͷ
            header = header.replace(/(proxy-)?connection\:.+\r\n/ig, '')
                .replace(/Keep-Alive\:.+\r\n/i, '')
                .replace("\r\n", '\r\nConnection: close\r\n');
            
            //�滻��ַ��ʽ(ȥ����������)
            if (req.httpVersion == '1.1') {
                var url = req.path.replace(/http\:\/\/[^\/]+/, '');
                if (url.path != url) header = header.replace(req.path, url);
            }
            
            buffer = buffer_add(new Buffer(header, 'utf8'), buffer.slice(_body_pos));
        }

        // second proxy mode
        if (!standalone) {
            startService(
                client,
                { allowHalfOpen: true, port: req.port, host: req.host},
                { 'encrypt': decrypt, 'decrypt': encrypt },
                { 'connectfunc': proxyConnectAction, 'req': req, 'buffer': buffer }
            );

            return;
        }

        // standalone proxy mode
        startService(
            client,
            { allowHalfOpen: true, port: req.port, host: req.host},
            null,
            { 'connectfunc': standAloneConnectAction, 'req': req, 'buffer': buffer }
        );
    }
}).listen(serverport);

console.log('Proxy server running at ' + serverip + ':' + serverport);

//������ִ���
process.on('uncaughtException', function (err) {
    console.log("\nError!!!!");
    console.log(err);
});

/*
 ������ͷ��ȡ��������ϸ��Ϣ
 ����� CONNECT ��������ô�᷵�� { method,host,port,httpVersion}
 ����� GET/POST ��������ô���� { metod,host,port,path,httpVersion}
*/
function parse_request(buffer) {
    var s = buffer.toString('utf8');
    
    var method = s.split('\n')[0].match(/^([A-Z]+)\s/)[1];
    
    if (method == 'CONNECT') {
        var arr = s.match(/^([A-Z]+)\s([^\:\s]+)\:(\d+)\sHTTP\/(\d.\d)/);
        
        if (arr && arr[1] && arr[2] && arr[3] && arr[4])
            return {
                method: arr[1],
                host: arr[2],
                port: arr[3],
                httpVersion: arr[4]
            };
    } else {
        var arr = s.match(/^([A-Z]+)\s([^\s]+)\sHTTP\/(\d.\d)/);
        
        if (arr && arr[1] && arr[2] && arr[3]) {
            var host = s.match(/Host\:\s+([^\n\s\r]+)/)[1];
            
            if (host) {
                var _p = host.split(':', 2);
                return {
                    method: arr[1],
                    host: _p[0],
                    port: _p[1] ? _p[1] : 80,
                    path: arr[2],
                    httpVersion: arr[3]
                };
            }
        }
    }
    
    return false;
}

/*
 ����buffer���������
*/
function buffer_add(buf1, buf2) {
    // second proxy mode
    if (!standalone) {
        decrypt(buf2);
    }

    var re = new Buffer(buf1.length + buf2.length);
    
    buf1.copy(re);
    buf2.copy(re, buf1.length);
    
    return re;
}

/*
 �ӻ������ҵ�ͷ���������("\r\n\r\n")��λ��
*/
function buffer_find_body(b) {
    for (var i = 0, len = b.length - 3; i < len; i++) {
        if (b[i] == 0x0d && b[i + 1] == 0x0a && b[i + 2] == 0x0d && b[i + 3] == 0x0a) {
            return i + 4;
        }
    }
    
    return -1;
}