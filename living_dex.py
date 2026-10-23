"""A living checklist derived exclusively from the signed-in profile's current box."""
from collections import Counter
from data.pokedex import DEX
from data.dex_forms import SPECIAL_FORMS

CATEGORIES = {'all':'All Pokémon', 'shiny':'Shiny', 'lucky':'Lucky', 'xxl':'XXL',
              'xxs':'XXS', 'gigantamax':'Gmax', 'mega':'Mega', 'shadow':'Shadow',
              'purified':'Purified', 'hundo':'Hundo'}


def living_dex(pokemons, loaded=True):
    names = dict(DEX)
    grouped = {}
    for pokemon in pokemons:
        pid = pokemon['pid']
        names.setdefault(pid, pokemon.get('species_name') or f'Species #{pid}')
        grouped.setdefault(pid, []).append(pokemon)
    rows = []
    summary = {key:{'owned':0,'missing':0,'unknown':0,'total':0} for key in CATEGORIES}
    for pid, name in sorted(names.items()):
        owned = grouped.get(pid, [])
        counts = {key:len(owned) if key == 'all' else sum(bool(p.get(key)) for p in owned)
                  for key in CATEGORIES}
        states = {}
        for key in CATEGORIES:
            if key in SPECIAL_FORMS and pid not in SPECIAL_FORMS[key] and not counts[key]:
                states[key] = 'not_catalogued'
                continue
            state = ('unknown' if not loaded else 'owned' if counts[key] else
                     'unknown' if key in ('xxl','xxs') and any(not p.get('size_known') for p in owned)
                     else 'missing')
            states[key] = state
            summary[key][state] += 1
            summary[key]['total'] += 1
        forms = Counter(p.get('name') or p.get('form') or 'Normal / unspecified' for p in owned)
        rows.append({'pid':pid,'species_name':name,'counts':counts,'states':states,
                     'forms':[{'name':form,'count':count} for form,count in sorted(forms.items())]})
    return {'loaded':loaded,'categories':CATEGORIES,'category_order':list(CATEGORIES),'summary':summary,'rows':rows}
