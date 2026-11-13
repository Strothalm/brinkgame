#!/usr/bin/env python3
"""Entfernt aus den *-mehr*.txt Dateien Fragen, die es im selben Paket schon gibt
(gleicher Fragetext, oder gleiche Antwort in derselben Kategorie und Stufe).
Aufruf: python3 scripts/dedupe-more.py"""
import glob, os, re, sys, unicodedata
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'packs')

def slug(s):
    s = unicodedata.normalize('NFD', s.lower()).replace('ß', 'ss')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

def norm(t): return re.sub(r'\s+', ' ', t.strip().lower())

def pack_id(lines, name):
    for l in lines:
        m = re.match(r'@id\s+(.+)', l.strip())
        if m: return m.group(1).strip()
    return slug(os.path.basename(name)[:-4])

def order(f):
    b = os.path.basename(f)
    return (re.sub(r'-mehr[^.]*', '', b), 1 if '-mehr' in b else 0, b)  # Hauptdatei zuerst, dann die -mehr-Dateien

files = sorted(glob.glob(os.path.join(root, '*.txt')), key=order)
seen_q, seen_a = {}, {}
removed_total = 0
for f in files:
    lines = open(f, encoding='utf-8').read().split('\n')
    pid = pack_id(lines, f)
    q_seen = seen_q.setdefault(pid, set()); a_seen = seen_a.setdefault(pid, set())
    is_more = '-mehr' in os.path.basename(f)
    cat, out, removed = None, [], 0
    for l in lines:
        s = l.strip()
        if s.startswith('#'):
            cat = slug(re.sub(r'^#+\s*', '', s)); out.append(l); continue
        parts = [p.strip() for p in s.split('|')]
        if not s or s.startswith('@') or s.startswith('//') or len(parts) < 3 or not parts[0].isdigit():
            out.append(l); continue
        qk, ak = norm(parts[1]), (cat, parts[0], norm(parts[2]))
        if is_more and (qk in q_seen or ak in a_seen):
            removed += 1; continue
        q_seen.add(qk); a_seen.add(ak); out.append(l)
    if removed:
        open(f, 'w', encoding='utf-8').write('\n'.join(out))
    if is_more: print(f'{os.path.basename(f)}: {removed} doppelte Fragen entfernt'); removed_total += removed
print('gesamt entfernt:', removed_total)
