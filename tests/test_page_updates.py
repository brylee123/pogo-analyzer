"""Regressions for Events ingestion, league eligibility and inventory grouping."""
import unittest
from unittest.mock import patch, Mock

import test_collection_history_assets as fixtures
export = fixtures.export
from parser import parse_pgo_json
from routes.analysis import build_local_teams
from services.events import fetch_events, get_events


class PageBehaviorTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.HistoryAssetTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.HistoryAssetTests.tearDownClass.__func__)
    setUp = fixtures.HistoryAssetTests.setUp
    tearDown = fixtures.HistoryAssetTests.tearDown

    def upload(self, raw):
        response = self.client.post('/api/upload', json=raw, headers={'Origin':'http://localhost'})
        self.assertEqual(200, response.status_code)

    def test_events_accept_null_dates_and_feed_event_ids(self):
        feed=[{'eventID':'unannounced','name':'Future event','start':None,'end':None},
              {'eventID':'upcoming','name':'Upcoming','start':'2099-01-01T00:00:00Z','end':'2099-01-02T00:00:00Z'}]
        response=Mock();response.json.return_value=feed
        with patch('services.events.requests.get',return_value=response),patch('services.tiers.get_tier_list',return_value={}):
            self.assertEqual(2,len(fetch_events(force=True)))
            events=get_events()
        self.assertEqual(['upcoming','unannounced'],[e['id'] for e in events])
        self.assertEqual('unknown',events[1]['status'])
        self.assertIsNone(self.client.get('/api/events/status').get_json()['last_err'])

    def test_failed_events_refresh_preserves_saved_feed_and_success_timestamp(self):
        response=Mock();response.json.return_value=[{'eventID':'cached','name':'Saved','start':None}]
        with patch('services.events.requests.get',return_value=response):fetch_events(force=True)
        before=self.client.get('/api/events/status').get_json()['last_ok']
        with patch('services.events.requests.get',side_effect=RuntimeError('Unavailable')):
            self.assertEqual([],fetch_events(force=True))
        status=self.client.get('/api/events/status').get_json()
        self.assertEqual(before,status['last_ok']);self.assertIn('Unavailable',status['last_err'])
        with patch('services.events.fetch_events'),patch('services.tiers.get_tier_list',return_value={}):
            self.assertEqual('cached',get_events()[0]['id'])

    def test_old_events_do_not_crowd_out_upcoming(self):
        feed=[{'eventID':str(i),'name':'Old','start':'2001-01-01','end':'2001-01-02'} for i in range(100)]
        feed.append({'eventID':'future','name':'Future','start':'2099-01-01','end':'2099-01-02'})
        response=Mock();response.json.return_value=feed
        with patch('services.events.requests.get',return_value=response),patch('services.tiers.get_tier_list',return_value={}):
            fetch_events(force=True)
            self.assertEqual('future',get_events()[0]['id'])

    def test_three_distinct_species_form_teams_in_all_leagues(self):
        for league in ('GL','UL','ML'):
            rows=[{'pid':pid,'cp':1200,'name':name,'pvp_rank':1} for pid,name in
                  [(150,'Mewtwo'),(383,'Groudon'),(382,'Kyogre')]]
            pool=[rows[0]]*30+rows[1:]
            teams=build_local_teams(pool,league)[3]
            self.assertTrue(teams,league)
            for team in teams:
                self.assertEqual(3,len({team[k]['pid'] for k in ('lead','switch','closer')}))

    def test_candidates_search_beyond_duplicate_top_twenty(self):
        raw=export();base=raw['pokemons'][0]
        raw['pokemons']=[dict(base,id=str(i),pokemonId=150,cp=1400) for i in range(30)]
        raw['pokemons'] += [dict(base,id='k',pokemonId=382,cp=1400),dict(base,id='g',pokemonId=383,cp=1400)]
        self.upload(raw)
        with patch('routes.analysis.get_tier_list',return_value={}),patch('routes.analysis.pvp_score',return_value=100),patch('routes.analysis.pvp_ideal_ivs',return_value=(15,15,15)):
            for league in ('GL','UL','ML'):
                data=self.client.get('/api/pvp-candidates?league='+league).get_json()
                self.assertTrue(data['local_teams'],league)

    def test_hidden_gems_respect_selected_league_and_current_evolution_level(self):
        raw=export();base=raw['pokemons'][0]
        raw['pokemons']=[dict(base,id='a',pokemonId=1,cp=1600),dict(base,id='b',pokemonId=150,cp=3000)]
        self.upload(raw)
        # All IVs qualify; only league limits and reachable evolution CP should filter.
        with patch('routes.analysis.pvp_iv_rank',return_value=(1,4096,100)),patch('routes.analysis.pvp_cp',return_value=(51,2000)),patch('routes.analysis.calculate_cp_for_level',side_effect=lambda pid,*args: 1400 if pid==1 else 2700):
            self.assertEqual([],self.client.get('/api/pvp-hidden-gems?league=GL').get_json())
            ultra=self.client.get('/api/pvp-hidden-gems?league=UL').get_json()
            self.assertEqual(1,len(ultra));self.assertEqual('Bulbasaur',ultra[0]['gem_target'])
            self.assertTrue(all(g['gem_league'].startswith('UL') for g in ultra))
            master=self.client.get('/api/pvp-hidden-gems?league=ML').get_json()
            self.assertEqual(2,len(master))
        for route in ('pvp-hidden-gems','pvp-candidates'):
            self.assertEqual(400,self.client.get('/api/'+route+'?league=invalid').status_code)

    def test_inventory_uses_game_category_order_and_separates_resources(self):
        raw=export();raw['items']=[{'item':1,'count':999,'itemName':'PokeBall'},
            {'item':101,'count':1,'itemName':'Potion'},
            {'item':1506,'count':1000,'itemName':'Mp'},
            {'item':1410,'count':5,'itemName':'EnhancedCurrency'},
            {'item':2102,'count':100,'itemName':'EventPassPointB'},
            {'item':999999,'count':2,'itemName':'UnknownCounter'}]
        items=parse_pgo_json(raw)['items']
        self.assertEqual([101,1],[it['id'] for it in items if it['in_bag']])
        self.assertEqual({1506,1410,2102,999999},{it['id'] for it in items if not it['in_bag']})

    def test_profile_preserves_exported_xp_thresholds(self):
        raw=export();raw['player'].update(level=80,experience=274613689,prevLevelExp=203353000,nextLevelExp=2147483647)
        player=parse_pgo_json(raw)['player']
        self.assertEqual(203353000,player['prevLevelExp'])
        self.assertEqual(2147483647,player['nextLevelExp'])

    def test_location_card_background_uses_explicit_export_evidence(self):
        raw=export()
        for value, expected in ((None,False),({},False),({'locationCard':0},False),({'locationCard':18},True)):
            raw['pokemons'][0]['pokemonDisplay']['locationCard']=value
            self.assertEqual(expected,parse_pgo_json(raw)['pokemons'][0]['background'])

    def test_virtual_evolution_resources_do_not_appear_in_bag(self):
        from collection_metadata import inventory_metadata
        for iid,name in ((1350,'FusionResourceDawnwingsNecrozma'),(1153,'ResourceCrownedZacian'),(1151,'OtherEvolutionStoneMapleA')):
            self.assertFalse(inventory_metadata(iid,name)['in_bag'])
        self.assertTrue(inventory_metadata(501,'TroyDisk')['in_bag'])
        self.assertEqual(8,inventory_metadata(501,'TroyDisk')['bag_order'])
        from data.pokedex import _resolve_item_name, DEX
        self.assertEqual('Lure Module',_resolve_item_name(501,'TroyDisk'))
        self.assertEqual('Max Particles',_resolve_item_name(1506,'Mp'))
        self.assertEqual('Flabébé',DEX[669])

    def test_retired_asset_endpoints_are_absent(self):
        self.assertEqual(404,self.client.get('/api/assets/catalog').status_code)
        self.assertEqual(404,self.client.get('/local-assets/icons/shiny.png').status_code)
        page=self.client.get('/').get_data(as_text=True)
        self.assertNotIn('sidebar-appearance',page)
        self.assertNotIn('data-asset-mode',page)
        self.assertIn('data-appearance-status',page)
