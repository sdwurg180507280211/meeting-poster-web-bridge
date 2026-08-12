import os, sys, socket, struct
# 使用脚本所在目录下的 photoshop 协议包
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photoshop.protocol import Protocol, ContentType

script_path = sys.argv[1]
password = os.environ.get('PS_PASSWORD') or '123456'
host, port = '127.0.0.1', 49494

s = socket.create_connection((host, port), timeout=10)
s.settimeout(60)
proto = Protocol(password)

script = open(script_path, encoding='utf-8').read()
body = struct.pack('>3I', 1, 0, int(ContentType.SCRIPT_SHARED)) + script.encode('utf-8')
enc = proto.enc.encrypt(body)
length = 4 + len(enc)
s.sendall(struct.pack('>2I', length, 0) + enc)

done = False
while not done:
    try:
        r = proto.receive(s)
        ct = r['content_type']
        print('RESPONSE ct=%s body=%r' % (ct, (r['body'] or b'')[:400]))
        if ct == ContentType.SCRIPT:
            done = True
    except socket.timeout:
        print('(socket timeout, stop)')
        break
    except ConnectionError as e:
        print('(closed):', e)
        break
    except ValueError as e:
        print('PROTOCOL ERROR:', e)
        break
s.close()
print('DONE')
