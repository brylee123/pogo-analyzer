"""Refresh category order and bag visibility from PokeMiners Game Master (metadata only)."""
import argparse
import json
import re
from pathlib import Path
from urllib.request import urlopen

SOURCE = 'https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json'
ROOT = Path(__file__).resolve().parents[1]


def build(data):
    config = next(row['data']['itemInventoryUpdateSettings'] for row in data
                  if 'itemInventoryUpdateSettings' in row.get('data', {}))
    order = {cat: row.get('sortOrder', 0) for row in config['categoryProto'] for cat in row['category']}
    items = {}
    for row in data:
        item = row.get('data', {}).get('itemSettings')
        if not item:
            continue
        key = re.sub('[^a-z0-9]', '', str(item['itemId']).lower().removeprefix('item_'))
        category = item.get('category', '')
        outside = item.get('hideItemInInventory', False) or category in {
            'ITEM_CATEGORY_EVENT_PASS_POINT', 'ITEM_CATEGORY_MP', 'ITEM_CATEGORY_ENHANCED_CURRENCY',
            'ITEM_CATEGORY_INVENTORY_UPGRADE'} or (
                category == 'ITEM_CATEGORY_EVOLUTION_REQUIREMENT' and item.get('ignoreInventorySpace', False))
        items[key] = {'category': category, 'order': order.get(category, 99), 'in_bag': not outside}
    return items


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, help='Read an already downloaded Game Master JSON')
    args = parser.parse_args()
    if args.metadata:
        data = json.loads(args.metadata.read_text(encoding='utf-8'))
    else:
        with urlopen(SOURCE, timeout=60) as response:
            data = json.load(response)
    (ROOT/'data/item_categories.json').write_text(json.dumps(build(data), indent=2)+'\n', encoding='utf-8')
