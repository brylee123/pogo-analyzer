"""Preserve species identity, export-reported forms, and inventory identifiers."""
import re
from data.pokedex import DEX


def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', str(value or '').lower()).strip('-')


def _enabled(value):
    return value is True or (isinstance(value, (int, float)) and value > 0) or str(value).lower() in ('true', 'yes')


def _mega_level(value):
    if isinstance(value, dict):
        value = value.get('level')
    if isinstance(value, bool):
        return 0
    try:
        number = int(value)
        return number if str(value).strip() == str(number) and number >= 0 else 0
    except (TypeError, ValueError, OverflowError):
        return 0


def _mega_form(value, pid):
    token = re.sub(r'[^a-z0-9]', '', str(value).lower())
    species = re.sub(r'[^a-z0-9]', '', DEX.get(pid, '').lower())
    if species and token.startswith(species):
        token = token[len(species):]
    return token in ('mega', 'megax', 'megay', 'megaevolution')


def pokemon_metadata(raw):
    display = raw.get('pokemonDisplay') or {}
    form = str(display.get('formName') or raw.get('formName') or '')
    alignment = display.get('alignment', raw.get('alignment', 0))
    costume = display.get('costumeName') or display.get('costume') or raw.get('costume')
    costume_name = str(costume or '')
    costumed = costume_name.lower() not in ('', '0', 'none', 'unset', 'costume_unset', 'normal')
    mega_level = max(_mega_level(source.get(key)) for source in (raw, display)
                     for key in ('megaLevel', 'megaEvolutionLevel'))
    temporary = display.get('temporaryEvolution') or raw.get('temporaryEvolution') or ''
    mega_active = any(_enabled(raw.get(k)) or _enabled(display.get(k)) for k in ('isMega', 'isMegaEvolved'))
    mega_active = mega_active or any(_mega_form(value, raw.get('pokemonId')) for value in (form, temporary))
    mega_history = _enabled(raw.get('hasMegaEvolved')) or bool(raw.get('megaEvolvedForms'))
    # Confirmed PGSharp export values: 1 = Dynamax, 2 = Gigantamax.
    # The form name may remain normal; breadMoves alone does not prove Max status.
    bread_gigantamax = display.get('breadModeEnum') in (2, '2')
    gigantamax = bread_gigantamax or 'gigantamax' in form.lower() or any(_enabled(raw.get(k)) or _enabled(display.get(k)) for k in ('isGigantamax', 'gigantamax'))
    bread_dynamax = display.get('breadModeEnum') in (1, '1')
    dynamax = bread_dynamax or gigantamax or 'dynamax' in form.lower() or any(_enabled(raw.get(k)) or _enabled(display.get(k)) for k in ('isDynamax', 'dynamax', 'dynamaxLevel'))
    purified = alignment in (2, '2', 'PURIFIED', 'Purified') or _enabled(raw.get('isPurified'))
    return {
        'species_name': DEX.get(raw.get('pokemonId'), f"Species #{raw.get('pokemonId', '?')}"),
        'form': form, 'form_slug': slug(form), 'purified': purified,
        'mega_active': bool(mega_active), 'mega_level': mega_level,
        'mega_history': bool(mega_history or mega_level),
        'mega': bool(mega_active or mega_history or mega_level),
        'dynamax': bool(dynamax), 'gigantamax': bool(gigantamax),
        'costumed': costumed, 'costume': costume_name if costumed else '',
    }


def item_metadata(iid, raw_name):
    """Do not guess a dated event from a numeric/letter pass identifier."""
    is_points = str(raw_name).startswith('EventPassPoint')
    return {
        'raw_name': str(raw_name or ''),
        'category': 'event_points' if is_points else 'item',
        'description': (
            'Event/GO Pass progress counter from the export, not a usable bag item. '
            'Different identifiers are separate counters. The export does not identify '
            'their event, date, expiry, or whether they are still active.' if is_points else
            'Inventory item reported by the export.'),
    }
