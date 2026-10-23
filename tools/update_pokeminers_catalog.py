"""Refresh verified artwork paths only; never download images or account data."""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data.pokedex import DEX, ITEMS

API = 'https://api.github.com/repos/PokeMiners/pogo_assets'
POKEMON_DIR = 'Pokemon - 256x256'


def normalize(value):
    value = str(value).replace('♀', 'female').replace('♂', 'male')
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFD', value).lower())


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'pogo-analyzer-asset-catalog'}), timeout=60) as response:
        return json.load(response)


def metadata():
    directories = {row['name']: row for row in fetch(API + '/contents/Images?ref=master')}
    result = {}
    for name in (POKEMON_DIR, 'Items', 'Filters', 'Menu Icons', 'Evolution', 'Raids', 'Pokestops and Gyms'):
        tree = fetch(directories[name]['git_url'] + '?recursive=1')
        if tree.get('truncated'):
            raise ValueError('Incomplete asset tree: ' + name)
        result[name] = {'sha': tree['sha'], 'paths': [row['path'] for row in tree['tree'] if row['type'] == 'blob']}
    return result


def build(source):
    pokemon = {}
    paths = source[POKEMON_DIR]['paths']
    # Legacy base icons fill species not present in the named addressable assets.
    for path in paths:
        match = re.fullmatch(r'pokemon_icon_(\d+)_00(_shiny)?\.png', path)
        if match:
            pid, shiny = match.groups()
            pokemon[f'{int(pid)}:' + (':shiny' if shiny else '')] = POKEMON_DIR + '/' + path
    for path in paths:
        match = re.fullmatch(r'Addressable Assets/pm(\d+)(?:\.f([A-Z0-9_]+))?(\.s)?\.icon\.png', path)
        if match:
            pid, form, shiny = match.groups()
            pokemon[f'{int(pid)}:{normalize(form or "")}' + (':shiny' if shiny else '')] = POKEMON_DIR + '/' + path
    item_files = set(source['Items']['paths'])
    item_map = {str(iid): f'Item_{iid:04}.png' for iid in ITEMS if f'Item_{iid:04}.png' in item_files}
    item_map.update({
        '1': 'pokeball_sprite.png', '2': 'greatball_sprite.png',
        '3': 'ultraball_sprite.png', '4': 'masterball_sprite.png',
        '301': 'luckyegg.png', '401': 'Incense_0.png',
        '501': 'TroyKey.png', '502': 'TroyKey_glacial.png',
        '503':'TroyKey_moss.png', '504':'TroyKey_magnetic.png', '505':'TroyKey_rainy.png', '506':'TroyKey_sparkly.png',
        '708': 'Item_0707.png', '709': 'poffin.3.png',
        '801': 'tx_ar_photo_camera.png',
        '901': 'EggIncubatorUnlimited_Empty.png', '902': 'EggIncubatorIAP_Empty.png',
        '903': 'EggIncubatorSuper_Empty.png', '905': 'EggIncubatorTimed_Empty.png',
        '1101': 'Bag_Sun_Stone_Sprite.png', '1102': "Bag_King's_Rock_Sprite.png",
        '1103': 'Bag_Metal_Coat_Sprite.png', '1104': 'Bag_Dragon_Scale_Sprite.png',
        '1105': 'Bag_Up-Grade_Sprite.png', '1106': 'Bag_Sinnoh_Stone_Sprite.png',
        '1107': 'Bag_Unova_Stone_Sprite.png', '1150': 'Bag_Other_Stone_A_Sprite.png',
        '1302': 'RareXLCandy_PSD.png', '1303': 'Item_1406.png',
        '1404': 'starpiece.png', '1410': 'Item_COIN_01.png',
        '1502': 'Item_Leader_MapCompass.png', '1505': 'Item_ShadowGem.png',
        '1352':'item_kyuremBlackFusionResource.png', '1353':'item_kyuremWhiteFusionResource.png',
        '1153':'sword_fusionResource.png', '1154':'shield_fusionResource.png',
    })
    if not all(path in item_files for path in item_map.values()):
        raise ValueError('A mapped item path is no longer in the asset repository')
    items = {iid: 'Items/' + path for iid, path in item_map.items()}
    icons = {
        'pvp': 'Menu Icons/btn_battle.png', 'raid': 'Raids/ActivityLogRaidLogo.png',
        'develop': 'Filters/ic_evolvable.png',
        'team1': 'Pokestops and Gyms/team_blue.png', 'team2': 'Pokestops and Gyms/team_red.png',
        'team3': 'Pokestops and Gyms/team_yellow.png', 'team0': 'Pokestops and Gyms/TeamLess.png',
        'total': 'Filters/ic_pokedex.png', 'shiny': 'Filters/ic_shiny_white.png',
        'shadow': 'Filters/ic_shadow_filter.png', 'lucky': 'Filters/ic_lucky_icon.png',
        'purified': 'Filters/ic_purified_filter.png', 'hatched': 'Filters/ic_hatched.png',
        'hundo': 'Filters/ic_appraisal_04.png', 'costumed': 'Filters/ic_event.png',
        'mega': 'Evolution/mega_evolution_icon.png', 'fav': 'Menu Icons/ic_fav_pressed.png',
        'event': 'Menu Icons/calendar_icon.png', 'stardust': 'Items/stardust_painted.png',
    }
    for path in icons.values():
        directory, filename = path.split('/', 1)
        if filename not in source[directory]['paths']:
            raise ValueError('Missing status icon: ' + path)
    return {'source': 'https://github.com/PokeMiners/pogo_assets',
            'trees': {key: value['sha'] for key, value in source.items()},
            'pokemon': dict(sorted(pokemon.items())),
            'names': {normalize(name): pid for pid, name in DEX.items()},
            'items': items, 'icons': icons,
            'itemNames': {normalize(ITEMS[int(iid)]): path for iid, path in items.items() if int(iid) in ITEMS}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, help='Use cached GitHub tree metadata')
    args = parser.parse_args()
    source = json.loads(args.metadata.read_text(encoding='utf-8')) if args.metadata else metadata()
    catalog = build(source)
    output = ROOT / 'static/js/pokeminers-data.js'
    output.write_text('// Generated by tools/update_pokeminers_catalog.py; paths only, no images.\n'
                      + 'window.PokeMinersAssets = ' + json.dumps(catalog, ensure_ascii=True, separators=(',', ':')) + ';\n', encoding='utf-8')
    special = {}
    for key, token in (('mega', 'mega'), ('gigantamax', 'gigantamax')):
        special[key] = sorted({int(name.split(':')[0]) for name in catalog['pokemon']
                               if name.split(':')[1].startswith(token)})
    (ROOT/'data/dex_forms.py').write_text(
        '# Generated from verified PokeMiners asset paths; not a release schedule.\n'
        + 'SPECIAL_FORMS = ' + repr(special) + '\n', encoding='utf-8')
    print(f'Indexed {len(catalog["pokemon"])} Pokemon variants and {len(catalog["items"])} items.')
