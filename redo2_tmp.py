import json, sys
sys.path.insert(0, 'analysis')
import analyze, db
conn = db.connect('data/eva.db')
changed = 0
for vid in (3, 2):
    v = conn.execute('select * from videos where id=?', (vid,)).fetchone()
    meta = {'width': v['width'], 'height': v['height'], 'fps': v['fps'], 'duration_s': v['duration_s']}
    for g in [dict(r) for r in conn.execute('select id, start_s, end_s, map from games where video_id=? order by start_s', (vid,))]:
        zones, loads = analyze._bar_zones(conn, g), db.loadouts_of(conn, g['id'])
        for k in db.kills_of(conn, g['id']):
            old = k['weapon']
            if k['killer_slot'] is None or old is None or k['kind'] == 'inferred':
                continue
            new = analyze.kill_weapon(v['path'], meta, zones, loads, k['killer_slot'], k['t'], old.startswith('G'))
            if new != old:
                changed += 1
                db.set_kill_weapon(conn, g['id'], k['t'], k['victim_slot'], new)
        conn.commit()
        print('game', g['id'], flush=True)
print('kills modifies:', changed)
