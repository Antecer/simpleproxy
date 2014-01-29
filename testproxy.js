var net = require('net');
var serverip = "127.0.0.1";
var local_port = 8894;
var localflag = 0;

if (process.argv.length >= 3) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(process.argv[2])) {
        serverip = process.argv[2];
    } else if ((process.argv[2] == "--help") || (process.argv[2] != "localhost")) {
        console.log("Usage:\n\tlocal pc:\trun - node testproxy.js\n\tremote pc:\tnode testproxy.js (localhost|remoteIP)\n")
        return;
    }

    local_port = 8893;
    localflag = 1;
}

//�ڱ��ش���һ��server��������local_port�˿�
net.createServer({ allowHalfOpen: true}, function (client) {
    //���ȼ�������������ݷ����¼���ֱ���յ������ݰ���������http����ͷ
    var buffer = new Buffer(0);
    
    client.on('data', function (data) {
        buffer = buffer_add(buffer, data);
        
        if (buffer_find_body(buffer) == -1) return;
        
        var req = parse_request(buffer);
        
        if (req === false) return;
        
        client.removeAllListeners('data');
        relay_connection(req);
    });
    
    //��http����ͷ��ȡ��������Ϣ�󣬼�������������������ݣ�ͬʱ����Ŀ�������������Ŀ������������ݴ��������
    function relay_connection(req) {
        console.log(req.method + ' ' + req.host + ':' + req.port);
        
        if (localflag) {
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

            // encrypt in local, decrypt for proxy in buffer_add
            for (var i = 0; i < buffer.length; i++) {
                buffer[i] += 1;
            }
        }
        
        client.pause();
        
        //�����������������������
        client.on("data", function (data) {
            if (!server.closeflag) {
                server.write(data);
            }
        });

        //������Ŀ�������������
        var server =  net.createConnection(
            localflag ? { allowHalfOpen: true, port: 8894, host: serverip} : { allowHalfOpen: true, port: req.port, host: req.host}
            );

        server.pause();
        
        server.on("data", function (data) {
            if (!client.closeflag) {
                // encrypt for local, decrypt for proxy
                for (var i = 0; i < data.length; i++) {
                    data[i] += localflag ? 1 : -1;
                }
                    
                client.write(data);
            }
        });
	      
        client.on("end", function () {
            client.closeflag = 1;
            server.end();
        });
        
        server.on("end", function () {
            server.closeflag = 1;
            client.end();
        });

        client.on("error", function () {
            client.closeflag = 1;
            server.destroy();
        });
        
        server.on("error", function () {
            server.closeflag = 1;
            client.destroy();
        });

        server.on("connect", function (socket) {
            client.resume();
            server.resume();
            
            if (req.method == 'CONNECT') {
                if (localflag) {
                    server.write(buffer);
                    client.write(new Buffer("HTTP/1.1 200 Connection established\r\nConnection: close\r\n\r\n"));
                }
            } else {
                server.write(buffer);
            }
        });
    }
}).listen(local_port);

console.log('Proxy server running at ' + serverip + ':' + local_port);

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
    if (!localflag) {
        // decrypt
        for (var i = 0; i < buf2.length; i++) {
            buf2[i] -= 1;
        }
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