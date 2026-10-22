"""Request-isolated analyzer state (replaces the former global user singleton)."""
from collections.abc import MutableMapping
from contextvars import ContextVar
_DEFAULT={"pokemons":[],"items":[],"player":None,"pvp_stats":None,"loaded":False}
_local=ContextVar("pogo_request_state",default=None)
def set_request_state(data=None):
    return _local.set(data if data is not None else {**_DEFAULT,"pokemons":[],"items":[]})
def clear_request_state(token):
    _local.reset(token)
class StateProxy(MutableMapping):
    def _data(self):
        state=_local.get()
        if state is None:
            raise RuntimeError("Analyzer state accessed outside an initialized request")
        return state
    def __getitem__(self,key):return self._data()[key]
    def __setitem__(self,key,value):self._data()[key]=value
    def __delitem__(self,key):del self._data()[key]
    def __iter__(self):return iter(self._data())
    def __len__(self):return len(self._data())
_state=StateProxy()
