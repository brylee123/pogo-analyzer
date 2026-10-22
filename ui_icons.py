"""Inline Pictogrammers Material Design Icons (Apache 2.0)."""
import json
from pathlib import Path
from markupsafe import Markup

MDI_PATHS = json.loads((Path(__file__).parent / 'static' / 'mdi-icons.json').read_text(encoding='utf-8'))


def mdi_icon(name):
    name = name if name in MDI_PATHS else 'information-outline'
    path = MDI_PATHS.get(name, MDI_PATHS['information-outline'])
    return Markup('<span class="mdi-shell" data-user-icon="'+name+'"><svg class="mdi-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + path + '"/></svg></span>')
