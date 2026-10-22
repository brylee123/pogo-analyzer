"""Create empty folders and documentation for user-supplied artwork; no downloads."""
import argparse
import json
from pathlib import Path

FOLDERS = ('pokemon/normal','pokemon/shiny','pokemon/forms','items','types','teams','icons')
EXAMPLE = {'pokemon:25':'pokemon/normal/0025.png',
           'pokemon:25:shiny':'pokemon/shiny/0025.png',
           'pokemon:6:charizard-mega-x':'pokemon/forms/0006-charizard-mega-x.png',
           'item:1':'items/1.png', 'icon:image-off-outline':'icons/missing.svg'}
README = '''# Optional local artwork

This folder was generated without downloading any artwork. Add only images you
have chosen to supply. Run the script again safely; existing files are untouched.

- pokemon/normal/0025.png: Pokédex #25, normal appearance
- pokemon/shiny/0025.png: Pokédex #25, shiny appearance
- pokemon/forms/0006-charizard-mega-x.png: exact exported form (slug in Pokémon table)
- items/1.png: numeric item ID, displayed on each inventory card
- types/fire.png, teams/mystic.png: type/team artwork
- icons/missing.svg: optional replacement for the unavailable-image icon

PNG, WebP, JPEG, GIF, and SVG are accepted. A four-digit Pokédex number is preferred;
un-padded numbers and slugged English names (pikachu.png) also work. Use lowercase
extensions. Form-specific artwork falls back to ordinary species artwork.

For custom filenames, copy manifest.example.json to manifest.json, then edit the
mapping. Include only mappings for files that exist. Keys accept pokemon:ID,
pokemon:ID:shiny, pokemon:ID:FORM-SLUG, pokemon:ID:FORM-SLUG:shiny, item:ID,
type:NAME, team:NAME, and icon:NAME. Paths must remain inside this folder.

Select Settings → Images: Local first or Local only, then Refresh asset list.
The folder is on the SERVER; other devices access these files through the app.
No browser upload, remote fetch, or automatic asset download is performed.
Set PGS_ASSET_DIR in .env to use a different server-side folder, then restart.
'''


def prepare(root):
    root=Path(root)
    for folder in FOLDERS:
        (root/folder).mkdir(parents=True,exist_ok=True)
    for name,content in (('README.md',README),('manifest.example.json',json.dumps(EXAMPLE,indent=2)+'\n')):
        path=root/name
        try:
            with path.open('x',encoding='utf-8') as stream:
                stream.write(content)
        except FileExistsError:
            pass
    return root.resolve()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',default=str(Path(__file__).parent/'local_assets'))
    print('Asset folders ready:',prepare(parser.parse_args().root))
    print('Add your own images, then refresh the asset list in Settings. Nothing was downloaded.')
