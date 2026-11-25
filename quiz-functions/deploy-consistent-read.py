# ========================================
# deploy-consistent-read.py - quiz-utils 레이어의 getActiveSession 을 강한 일관 읽기로 (2026-11-25)
#   python deploy-consistent-read.py [--dry]        (보통은 deploy-consistent-read.ps1 로: SSO 로그인 → 이것)
#
#   왜: GetActiveQuestion 이 getActiveSession(GetItem, ConsistentRead 없음)으로 세션을 읽어, 답 응답 바로 뒤의 확인이
#       쓰기 전 세션(방금 채점한 문제)을 돌려준 일이 있음(2026-11-23). 같은 함수를 쓰는 ProcessQuestionAnswer 의 읽고-쓰기,
#       일시정지 · 다시 시작도 낡은 세션으로 덮어쓸 수 있음. 게임 문서: Docs/시스템_정리_콘텐츠_아이디어.md §13 '2026-11-25'.
#
#   하는 일:
#     1. 대상 람다(TARGETS — 세션을 읽는 일곱)의 설정에서 quiz-utils 레이어 판을 찾음
#        (판 내용에 nodejs/node_modules/quiz-utils/sessionManager.js 가 있는 레이어)
#     2. 쓰이는 판마다: 그 판을 그대로 받아 sessionManager.js 의 getActiveSession 안 GetItemCommand 에만 ConsistentRead: true 를 넣고,
#        다른 항목은 바이트 그대로 복사한 zip → publish-layer-version (같은 레이어 이름 · 런타임 · 아키텍처)
#        (quiz-utils/layer.zip 은 2026-05-17 것이라 다시 묶지 않음 — 배포된 판의 의존성 그대로)
#     3. 그 판을 쓰던 대상 람다만 레이어를 새 판으로 (update-function-configuration --layers, 다른 레이어 · 순서 그대로) → function-updated-v2
#        코드는 그대로라 기기 검사(wrap-device-guard)를 다시 끼울 필요 없음. 같은 판을 쓰는 다른 람다는 알리기만 함.
#     4. dist-consistent-read/record.json 에 판 바꾸기 기록(되돌리기: old_layers 로 --layers)
#   --dry: 받기 · 고치기 · zip 확인까지(읽기만). 올리기 · 바꾸기는 안 함
# ========================================
import json, os, shutil, subprocess, sys, urllib.request, zipfile
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
PROFILE = 'inchul'
REGION = 'ap-northeast-2'
DRY = '--dry' in sys.argv
TARGETS = ['GetActiveQuestion', 'ProcessQuestionAnswer', 'GetQuizSession', 'PauseSession', 'ResumeSession',
           'AbandonQuizSession', 'ClaimDevice']
SM_PATH = 'nodejs/node_modules/quiz-utils/sessionManager.js'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'dist-consistent-read')
AWS = shutil.which('aws') or 'aws'
NOTE = 'getActiveSession ConsistentRead 2026-11-25'


def aws(*args, mutating=False, json_out=True):
    shown = ' '.join(a if ' ' not in a else '"%s"' % a for a in args)
    print('$ aws ' + shown, flush=True)
    if DRY and mutating:
        print('  (dry: skipped)', flush=True)
        return None
    cmd = [AWS, *args, '--profile', PROFILE, '--region', REGION] + (['--output', 'json'] if json_out else [])
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        sys.exit('aws failed (%d): %s' % (r.returncode, (r.stderr or r.stdout).strip()[:800]))
    out = (r.stdout or '').strip()
    return json.loads(out) if (json_out and out) else out


def patch(text):
    """getActiveSession 안의 GetItemCommand 하나에만 ConsistentRead: true. 이미 있으면 None."""
    i = text.find('export async function getActiveSession(')
    if i < 0:
        raise SystemExit('getActiveSession not found in sessionManager.js')
    j = text.find('export async function', i + 10)
    j = len(text) if j < 0 else j
    body = text[i:j]
    if 'ConsistentRead' in body:
        return None
    if body.count('new GetItemCommand({') != 1:
        raise SystemExit('expected exactly one GetItemCommand in getActiveSession, found %d' % body.count('new GetItemCommand({'))
    body = body.replace('new GetItemCommand({', 'new GetItemCommand({ ConsistentRead: true,', 1)
    return text[:i] + body + text[j:]


def patch_zip(src, dst):
    """src 레이어 zip → dst: sessionManager.js 만 고치고 나머지 항목은 그대로. 상태 None(그 파일 없음) · 'already' · 'patched'"""
    with zipfile.ZipFile(src) as zin:
        if SM_PATH not in zin.namelist():
            return None
        old = zin.read(SM_PATH).decode('utf-8')
        new = patch(old)
        if new is None:
            return 'already'
        with zipfile.ZipFile(dst, 'w') as zout:
            for zi in zin.infolist():
                data = new.encode('utf-8') if zi.filename == SM_PATH else zin.read(zi.filename)
                if not zi.external_attr:
                    # 권한 정보가 없는 항목(Windows 에서 묶은 zip — 2026-05 layer.zip 이 모두 이렇다): zipfile 은 쓰면서 0600(주인만 읽기)을
                    #   넣어 버려 람다 실행 사용자가 못 읽게 됨 → 모두 읽을 수 있게 명시 (파일 0644 · 폴더 0755, 유닉스에서 묶은 것으로)
                    zi.create_system = 3
                    zi.external_attr = ((0o040755 << 16) | 0x10) if zi.is_dir() else (0o100644 << 16)
                zout.writestr(zi, data, compress_type=zi.compress_type)
    # 확인: 항목이 같고, sessionManager.js 말고는 CRC 같고, 고친 줄이 하나, 모든 항목을 누구나 읽을 수 있음
    with zipfile.ZipFile(src) as a, zipfile.ZipFile(dst) as b:
        if b.testzip() is not None:
            raise SystemExit('patched zip is corrupt')
        unreadable = [z.filename for z in b.infolist() if z.create_system == 3 and
                      (((z.external_attr >> 16) & 0o444) != 0o444 or (z.is_dir() and ((z.external_attr >> 16) & 0o111) != 0o111))]
        unknown = [z.filename for z in b.infolist() if z.create_system != 3 and z.external_attr >> 16]
        if unreadable or unknown:
            raise SystemExit('patched zip has entries Lambda might not read: %s' % (unreadable + unknown)[:5])
        ca = {z.filename: z.CRC for z in a.infolist()}
        cb = {z.filename: z.CRC for z in b.infolist()}
        diff = sorted(n for n in set(ca) | set(cb) if ca.get(n) != cb.get(n))
        if diff != [SM_PATH]:
            raise SystemExit('patched zip differs in more than sessionManager.js: %s' % diff[:10])
        if b.read(SM_PATH).decode('utf-8').count('ConsistentRead: true') != 1:
            raise SystemExit('patched sessionManager.js does not have exactly one ConsistentRead')
    print('  patched %s: %d entries, only %s changed (%d -> %d bytes)' % (os.path.basename(dst), len(cb), SM_PATH, len(old), len(new)))
    return 'patched'


def build_patched_zip(version_arn, tag):
    info = aws('lambda', 'get-layer-version-by-arn', '--arn', version_arn)
    src = os.path.join(OUT, '%s_original.zip' % tag)
    dst = os.path.join(OUT, '%s_consistent.zip' % tag)
    with urllib.request.urlopen(info['Content']['Location'], timeout=180) as r, open(src, 'wb') as f:
        f.write(r.read())
    state = patch_zip(src, dst)
    if state == 'already':
        print('  %s already has ConsistentRead in getActiveSession - nothing to publish' % version_arn)
    return info, (dst if state == 'patched' else None), state


def main():
    os.makedirs(OUT, exist_ok=True)
    print('%s  %s' % (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'DRY RUN (no changes)' if DRY else 'DEPLOY'))

    # 1. 대상 람다의 레이어
    configs = {}
    for fn in TARGETS:
        c = aws('lambda', 'get-function-configuration', '--function-name', fn)
        configs[fn] = [l['Arn'] for l in (c.get('Layers') or [])]
        print('  %-20s %s' % (fn, ', '.join(a.split(':layer:')[1] for a in configs[fn]) or '(no layers)'))

    # quiz-utils 레이어 = sessionManager.js 가 든 판. 이름은 ARN 의 layer:<이름>:<판>
    version_infos = {}
    quiz_versions = set()
    for arn in sorted({a for arns in configs.values() for a in arns}):
        tag = arn.split(':layer:')[1].replace(':', '_v')
        info, dst, state = build_patched_zip(arn, tag)
        if state is None:
            print('  %s has no %s (not the quiz-utils layer)' % (arn.split(':layer:')[1], SM_PATH))
            continue
        quiz_versions.add(arn)
        version_infos[arn] = (info, dst, state)
    if not quiz_versions:
        sys.exit('no target uses a layer with %s - stopping' % SM_PATH)
    layer_names = {a.rsplit(':', 1)[0] for a in quiz_versions}
    print('quiz-utils layer: %s, versions in use by targets: %s' % (', '.join(sorted(n.split(':layer:')[1] for n in layer_names)),
                                                              ', '.join(sorted(a.rsplit(':', 1)[1] for a in quiz_versions))))

    # 같은 판을 쓰는 다른 람다 (알리기만)
    allf = aws('lambda', 'list-functions', '--query', 'Functions[].{F:FunctionName,L:Layers[].Arn}')
    others = sorted(f['F'] for f in allf if f['F'] not in TARGETS and any(a in quiz_versions for a in (f.get('L') or [])))
    print('other functions on the same version(s) (left as they are): %s' % (', '.join(others) or 'none'))

    # 2. 새 판 올리기
    new_arn_of = {}
    for arn in sorted(quiz_versions):
        info, dst, state = version_infos[arn]
        if state == 'already':
            continue
        desc = ((info.get('Description') or '').strip() + ' | ' + NOTE).strip(' |')[-256:]
        args = ['lambda', 'publish-layer-version', '--layer-name', arn.rsplit(':', 1)[0], '--description', desc,
                '--zip-file', 'fileb://' + dst.replace('\\', '/')]
        if info.get('CompatibleRuntimes'):
            args += ['--compatible-runtimes', *info['CompatibleRuntimes']]
        if info.get('CompatibleArchitectures'):
            args += ['--compatible-architectures', *info['CompatibleArchitectures']]
        if info.get('LicenseInfo'):
            args += ['--license-info', info['LicenseInfo']]
        r = aws(*args, mutating=True)
        new_arn_of[arn] = r['LayerVersionArn'] if r else arn.rsplit(':', 1)[0] + ':<new>'
        print('  %s -> %s' % (arn.split(':layer:')[1], new_arn_of[arn].split(':layer:')[1]))

    # 3. 대상 람다의 레이어만 새 판으로
    record = {'when': datetime.now().isoformat(timespec='seconds'), 'dry': DRY, 'note': NOTE, 'versions': new_arn_of, 'functions': []}
    for fn in TARGETS:
        old = configs[fn]
        new = [new_arn_of.get(a, a) for a in old]
        if new == old:
            print('  %-20s unchanged' % fn)
            continue
        aws('lambda', 'update-function-configuration', '--function-name', fn, '--layers', *new, mutating=True)
        aws('lambda', 'wait', 'function-updated-v2', '--function-name', fn, mutating=True, json_out=False)
        record['functions'].append({'name': fn, 'old_layers': old, 'new_layers': new})
        print('  %-20s layers -> %s' % (fn, ', '.join(a.split(':layer:')[1] for a in new)))

    with open(os.path.join(OUT, 'record%s.json' % ('_dry' if DRY else '')), 'w', encoding='utf-8') as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    if not DRY and record['functions']:
        print('rollback (per function): aws lambda update-function-configuration --function-name <F> --layers <old_layers from dist-consistent-read/record.json>')
    print('done (dry run - nothing changed)' if DRY else 'done - %d functions now read the session with ConsistentRead' % len(record['functions']))


if __name__ == '__main__':
    main()
