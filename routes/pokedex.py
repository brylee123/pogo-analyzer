from flask import Blueprint, jsonify
from living_dex import living_dex
from state import _state

bp = Blueprint('pokedex', __name__)


@bp.get('/api/pokedex')
def pokedex():
    return jsonify(living_dex(_state['pokemons'], loaded=_state['loaded']))
