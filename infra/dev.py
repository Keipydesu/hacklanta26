"""Local Compose launcher. Standard library only; never prints or rotates existing secrets."""
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import urllib.request

INFRA = Path(__file__).resolve().parent
ROOT = INFRA.parent


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def prepare_env(path, existing_database=False):
    if path.is_symlink():
        raise ValueError('Refusing a symlink for ENV_FILE.')
    text = path.read_text() if path.exists() else (INFRA / '.env.example').read_text()
    for key in ('PRODUCT_DB_PASSWORD', 'AUTOMATION_PUBLISH_KEY'):
        values = re.findall(rf'^{key}=(.*)$', text, re.M)
        if len(values) > 1:
            raise ValueError(f'Duplicate {key} in {path}; keep one value.')
        value = values[0] if values else ''
        if not value or value.startswith('replace-'):
            if existing_database:
                raise ValueError(f'{key} is missing/placeholder, but a database volume already exists. '
                                 'Restore the original infra/.env; do not reset the volume or generate a new password.')
            replacement = f'{key}={secrets.token_hex(32)}'
            text = (re.sub(rf'^{key}=.*$', replacement, text, flags=re.M) if values
                    else text.rstrip('\n') + '\n' + replacement + '\n')
    # Protect secrets before writing, including an existing file with broad permissions.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(text)
    return dict(line.split('=', 1) for line in text.splitlines()
                if '=' in line and not line.startswith('#'))


def lan_address():
    if os.environ.get('LAN_IP'):
        candidate = os.environ['LAN_IP']
    elif sys.platform == 'darwin':
        route = run(['route', '-n', 'get', 'default'], capture_output=True, text=True).stdout
        interface = re.search(r'interface:\s+(\S+)', route)
        if not interface:
            raise ValueError('No default network interface. Set LAN_IP to your Wi-Fi IPv4 address.')
        candidate = run(['ipconfig', 'getifaddr', interface[1]], capture_output=True, text=True).stdout.strip()
    else:
        # UDP connect selects the outbound interface without sending a packet.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(('192.0.2.1', 9))
            candidate = sock.getsockname()[0]
    address = ipaddress.IPv4Address(candidate)
    if address.is_loopback or address.is_unspecified or address.is_multicast:
        raise ValueError('LAN_IP must be a phone-reachable IPv4 address, not localhost.')
    return str(address)


def check_port(bind, port, service, compose, env):
    # A port published by our already-running service is reusable on subsequent launches.
    lookup = subprocess.run([str(arg) for arg in compose + ['port', service, '8000' if service == 'api' else '8081']],
                            env=env, capture_output=True, text=True)
    published = lookup.stdout.strip() if lookup.returncode == 0 else ''
    if published and published.rsplit(':', 1)[-1] == str(port):
        return
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        # Like the servers, allow reuse after closed connections enter TIME_WAIT.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((bind, port))
        except OSError as error:
            raise ValueError(f'Port {port} is in use. Stop the standalone '
                             f'{"backend" if service == "api" else "Expo"} terminal (Ctrl+C), '
                             f'or set {"API_PORT" if service == "api" else "EXPO_PORT"} to a free port.') from error


def main():
    action = sys.argv[1] if len(sys.argv) == 2 else 'up' if len(sys.argv) == 1 else ''
    if action not in ('up', 'down', 'logs', 'status'):
        raise ValueError('Usage: ./infra/dev.sh [up|down|logs|status]')
    run(['docker', 'info'], stdout=subprocess.DEVNULL)
    path = Path(os.environ.get('ENV_FILE', str(INFRA / '.env')))
    if path.is_symlink():
        raise ValueError('Refusing a symlink for ENV_FILE.')
    path = path.resolve()
    project = os.environ.get('COMPOSE_PROJECT_NAME', 'infra')
    # Preserve the base stack's volume, including an operator-selected project name.
    volumes = run(['docker', 'volume', 'ls', '--format', '{{.Name}}'], capture_output=True, text=True).stdout.splitlines()
    if action == 'up':
        # Only ignored, untracked in-repository files may receive generated credentials.
        relative = path.relative_to(ROOT)
        tracked = run(['git', '-C', ROOT, 'ls-files', '--', relative], capture_output=True, text=True).stdout
        if tracked.strip():
            raise ValueError('ENV_FILE must not be tracked by Git.')
        run(['git', '-C', ROOT, 'check-ignore', '-q', relative])
        settings = prepare_env(path, f'{project}_product-data' in volumes)
        lan = lan_address()
    else:
        if not path.exists():
            raise ValueError('No local environment file; run ./infra/dev.sh first.')
        settings = dict(line.split('=', 1) for line in path.read_text().splitlines()
                        if '=' in line and not line.startswith('#'))
        lan = os.environ.get('LAN_IP', '127.0.0.1')  # interpolation only; never used to restart services
    env = dict(os.environ, LAN_IP=lan, ENV_FILE=str(path))
    compose = ['docker', 'compose', '--env-file', path, '-f', INFRA / 'docker-compose.yml',
               '-f', INFRA / 'docker-compose.dev.yml', '--profile', 'routing']
    services = ['db', 'valhalla', 'api', 'mobile']
    if action == 'down':
        # Stop only our four services. Preserve data, routing tiles and optional services.
        run(compose + ['stop'] + services, env=env)
        return
    if action in ('logs', 'status'):
        run(compose + (['logs', '-f', '--tail', '50'] if action == 'logs' else ['ps']) + services, env=env)
        return
    port = int(env.get('API_PORT', settings.get('API_PORT', '8000')))
    expo_port = int(env.get('EXPO_PORT', settings.get('EXPO_PORT', '8081')))
    bind = env.get('API_BIND', settings.get('API_BIND', '0.0.0.0'))
    if bind not in ('0.0.0.0', lan):
        raise ValueError('Local phone mode requires API_BIND=0.0.0.0 or LAN_IP; hosted HTTPS uses the base Compose file.')
    if not all(1 <= p <= 65535 for p in (port, expo_port)) or port == expo_port:
        raise ValueError('API_PORT and EXPO_PORT must be distinct valid ports.')
    for number, service in ((port, 'api'), (expo_port, 'mobile')):
        check_port(bind, number, service, compose, env)
    tiles = INFRA / 'valhalla/custom_files'
    if not all((tiles / name).is_file() and (tiles / name).stat().st_size
               for name in ('valhalla.json', 'valhalla_tiles.tar')):
        print('Preparing GSU routing tiles for the first launch…', flush=True)
        run(['bash', INFRA / 'valhalla/build_tiles.sh', '--campus'], env=env)
    run(compose + ['up', '-d', '--build', '--wait', '--wait-timeout', '180'] + services, env=env)
    base = f'http://{lan}:{port}'
    run([INFRA / 'check_stack.sh', base, '--expect-storage', 'postgis',
         '--expect-routing', 'valhalla', '--probe-route'], env=env)
    request = urllib.request.Request(f'http://{lan}:{expo_port}',
                                     headers={'expo-platform': 'ios', 'Accept': 'application/expo+json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        manifest = json.load(response)
    if not manifest['launchAsset']['url'].startswith(f'http://{lan}:{expo_port}/'):
        raise ValueError('Expo advertised the wrong bundle address; inspect ./infra/dev.sh logs.')
    print(f'\nApplication ready. API: {base}\nOpen in Expo Go: exp://{lan}:{expo_port}\n'
          f'Phone and computer must share a reachable Wi-Fi network.\n'
          f'Logs: ./infra/dev.sh logs    Stop (keeps data): ./infra/dev.sh down', flush=True)
    # Reuse the QR library already locked with Expo; no new dependency or host npm install.
    run(compose + ['exec', '-T', 'mobile', 'node', '-e',
                   "const p=require('node:path'); const cli=require.resolve('@expo/cli/package.json', "
                   "{paths:[p.dirname(require.resolve('expo/package.json'))]}); "
                   "require(p.join(p.dirname(cli),'build/src/utils/qr.js')).printQRCode(process.argv[1]).print()",
                   f'exp://{lan}:{expo_port}'], env=env)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'error: {error}', file=sys.stderr)
        print('Check Docker Desktop is running. For service failures: ./infra/dev.sh logs', file=sys.stderr)
        sys.exit(1)
