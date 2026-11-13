#!/usr/bin/env python3
"""Hilfsskript: ersetzt oder löscht Zeilen einer Paketdatei anhand von Teilstrings.
Aufruf als Modul: from fixlines import fix"""
import sys
def fix(path, rules):
    lines = open(path, encoding='utf-8').read().split('\n')
    out, used = [], set()
    for l in lines:
        hit = next((k for k in rules if k in l), None)
        if hit is None:
            out.append(l); continue
        used.add(hit)
        if rules[hit] is not None: out.append(rules[hit])
    miss = [k for k in rules if k not in used]
    open(path, 'w', encoding='utf-8').write('\n'.join(out))
    print(f'{path.split("/")[-1]}: {len(used)} Zeilen angepasst', ('| NICHT GEFUNDEN: ' + str(miss)) if miss else '')
