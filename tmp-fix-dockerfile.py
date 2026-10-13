import io

raw = io.open('Dockerfile', 'rb').read().decode('utf-8')
nl = '\r\n' if '\r\n' in raw else '\n'
lines = raw.split(nl)
out = []
skip_apt_block = False
for ln in lines:
    if ln.startswith('RUN apt-get update'):
        skip_apt_block = True
        continue
    if skip_apt_block:
        # pula as linhas de continuação do bloco apt antigo (chromium dbus / rm -rf)
        if ln.startswith('    ') and ('chromium' in ln or 'rm -rf' in ln):
            skip_apt_block = False if 'rm -rf' in ln else skip_apt_block
            continue
        skip_apt_block = False
    if ln.startswith('RUN corepack enable'):
        out.append(ln)
        out.append('')
        out.append('# build tools ANTES do pnpm install: sharp@0.32.6 compila do fonte (node-gyp)')
        out.append('RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \\')
        out.append('    python3 make g++ chromium dbus && \\')
        out.append('    rm -rf /var/lib/apt/lists/*')
        continue
    out.append(ln)

new = nl.join(out)
assert 'python3 make g++' in new, 'apt novo nao inserido'
assert new.count('apt-get update') == 1, f"apt count: {new.count('apt-get update')}"
io.open('Dockerfile', 'wb').write(new.encode('utf-8'))
print('DOCKERFILE_OK')
