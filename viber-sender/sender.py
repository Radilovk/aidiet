"""XBODY Burgas — Viber messages from the studio's own Viber account (Viber Desktop on this PC).

The worker keeps the queue (booking confirmations, moves, cancels, reminders); this script asks it every
POLL_SECONDS for the messages due, opens each client's chat in Viber Desktop (viber://chat?number=…), pastes the
text and presses Enter, then tells the worker it was sent. Settings: config.ini next to this file (see README.md).

    python sender.py            sends
    python sender.py --dry-run  only shows what it would send (nothing is sent, nothing is acked)
    python sender.py --once     one round, then stops (for a test)
"""
import configparser
import datetime
import os
import random
import subprocess
import sys
import time
import urllib.parse

import pyautogui
import pyperclip
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = configparser.ConfigParser()
cfg.read(os.path.join(HERE, 'config.ini'), encoding='utf-8')
S = cfg['sender'] if cfg.has_section('sender') else {}

WORKER_URL = S.get('worker_url', 'https://aidiet.radilov-k.workers.dev').rstrip('/')
TOKEN = S.get('token', '')
POLL_SECONDS = int(S.get('poll_seconds', '120'))
OPEN_WAIT = float(S.get('open_wait_seconds', '4'))          # Viber Desktop opening the chat
GAP_MIN, GAP_MAX = (int(x) for x in S.get('gap_seconds', '25-60').split('-'))   # between two messages
HOURS = tuple(int(x) for x in S.get('hours', '8-21').split('-'))               # sends only in this window

DRY = '--dry-run' in sys.argv
ONCE = '--once' in sys.argv
pyautogui.FAILSAFE = True   # the mouse in a screen corner stops the script


def log(*a):
    print(datetime.datetime.now().strftime('%d.%m %H:%M:%S'), *a, flush=True)


def api(method, path, body=None):
    r = requests.request(method, WORKER_URL + path, json=body, timeout=30,
                         headers={'Authorization': 'Bearer ' + TOKEN})
    r.raise_for_status()
    return r.json()


def open_chat(phone):
    url = 'viber://chat?number=' + urllib.parse.quote(phone)
    if sys.platform.startswith('win'):
        os.startfile(url)
    elif sys.platform == 'darwin':
        subprocess.run(['open', url], check=True)
    else:
        subprocess.run(['xdg-open', url], check=True)


def focus_viber():
    """Viber's window to the front (Windows); elsewhere the opened chat already is."""
    if not sys.platform.startswith('win'):
        return
    try:
        import pygetwindow
        wins = [w for w in pygetwindow.getWindowsWithTitle('Viber') if w.title.strip()]
        if wins:
            w = wins[0]
            if w.isMinimized:
                w.restore()
            w.activate()
            time.sleep(0.5)
    except Exception as err:   # the chat link has usually brought it up anyway
        log('  (прозорецът на Viber не се извади отпред:', err, ')')


def send(phone, text):
    open_chat(phone)
    time.sleep(OPEN_WAIT)
    focus_viber()
    pyperclip.copy(text)
    paste = ('command', 'v') if sys.platform == 'darwin' else ('ctrl', 'v')
    pyautogui.hotkey(*paste)
    time.sleep(0.6)
    pyautogui.press('enter')
    time.sleep(1.0)


def round_once():
    hour = datetime.datetime.now().hour
    if not (HOURS[0] <= hour < HOURS[1]):
        return 0
    box = api('GET', '/api/xbody/viber/outbox')
    if not box.get('on', True):
        log('Внимание: XBODY_VIBER не е "on" в worker-а — нови съобщения няма да се трупат.')
    msgs = box.get('messages', [])
    for i, m in enumerate(msgs):
        log('→', m['to'], '|', m['text'][:70].replace('\n', ' '))
        if DRY:
            continue
        try:
            send(m['to'], m['text'])
            api('POST', '/api/xbody/viber/ack', {'id': m['id'], 'ok': True})
            log('  изпратено ✓')
        except pyautogui.FailSafeException:
            raise
        except Exception as err:
            log('  не се изпрати:', err)
            try:
                api('POST', '/api/xbody/viber/ack', {'id': m['id'], 'ok': False, 'error': str(err)[:200]})
            except Exception:
                pass
        if i < len(msgs) - 1:
            time.sleep(random.randint(GAP_MIN, GAP_MAX))   # not a burst: like a person writing
    return len(msgs)


def main():
    if len(TOKEN) < 16:
        sys.exit('Няма token в config.ini (същият като XBODY_VIBER_TOKEN в worker-а).')
    log('XBODY Viber изпращач —', WORKER_URL, '(само преглед)' if DRY else '',
        f'· часове {HOURS[0]}:00–{HOURS[1]}:00 · проверка на {POLL_SECONDS} с')
    log('Спиране: Ctrl+C или мишката в горния ляв ъгъл на екрана.')
    while True:
        try:
            round_once()
        except pyautogui.FailSafeException:
            sys.exit('Спряно (мишката в ъгъла).')
        except requests.RequestException as err:
            log('Няма връзка с worker-а:', err)
        if ONCE:
            break
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
