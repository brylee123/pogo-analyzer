import copy
import json
import os
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import test_appearance as appearance_fixture
from database import get_db
from parser import parse_pgo_json
from history import ingest
from history_reports import history_report, date_bound, session_detail
from local_assets import init_assets, safe_asset, catalog
from prepare_assets import prepare
import local_assets


def export(stamp='2026-01-31T12:00:00Z', xp=100):
    return {'time':stamp,'account':{'name':'Ash','team':1,'currencyBalance':[]},
            'player':{'experience':xp,'numPokemonCaptured':xp},
            'pokemons':[{'id':'one','pokemonId':107,'cp':1800,'cpMultiplier':0.73,
                         'individualAttack':15,'individualDefense':15,'individualStamina':15,
                         'nickname':'100% Perfect','pokemonDisplay':{'alignment':2}}],
            'items':[{'item':900001,'itemName':'EventPassPointA','count':50},
                     {'item':900002,'itemName':'EventPassPointB','count':60}]}


class CollectionParsingTests(unittest.TestCase):
    def test_purified_shiny_lucky_latios_statuses_coexist(self):
        raw=export()
        raw['pokemons']=[{
            'id':'example-latios','pokemonId':381,'cp':3281,
            'cpMultiplier':0.667934000492096,
            'additionalCpMultiplier':0.06680700927972794,
            'individualAttack':15,'individualDefense':13,'individualStamina':15,
            'nickname':'Example SL','isLucky':True,'favorite':True,
            'hasMegaEvolved':False,'megaEvolvedForms':[],
            'move2IsPurifiedExclusive':False,'breadMoves':[],
            'pokemonDisplay':{'alignment':2,'breadModeEnum':0,'costume':0,
                              'form':1634,'formName':'LatiosNormal','shiny':True,
                              'megaEvolutionLevel':None}
        }]
        pokemon=parse_pgo_json(raw)['pokemons'][0]
        self.assertEqual(('Latios',381,3281),
                         (pokemon['species_name'],pokemon['pid'],pokemon['cp']))
        self.assertTrue(all(pokemon[key] for key in ('purified','shiny','lucky')))
        self.assertFalse(any(pokemon[key] for key in ('shadow','dynamax','gigantamax','mega','costumed')))
        # Nickname, species, and move flags must not substitute for exported status.
        raw['pokemons'][0]['isLucky']=False
        raw['pokemons'][0]['pokemonDisplay'].update(alignment=0,shiny=False)
        normal=parse_pgo_json(raw)['pokemons'][0]
        self.assertFalse(any(normal[key] for key in ('purified','shiny','lucky')))

    def test_gigantamax_lapras_with_normal_form_name(self):
        raw=export()
        raw['pokemons']=[{
            'id':'example-lapras','pokemonId':131,'cp':1469,
            'cpMultiplier':0.5974000096321106,
            'individualAttack':12,'individualDefense':14,'individualStamina':11,
            'breadMoves':[{'moveLevel':1,'moveType':1}],
            'pokemonDisplay':{'alignment':0,'breadModeEnum':2,'costume':0,
                              'form':322,'formName':'LaprasNormal'}
        }]
        for value in (2,'2'):
            with self.subTest(breadModeEnum=value):
                raw['pokemons'][0]['pokemonDisplay']['breadModeEnum']=value
                pokemon=parse_pgo_json(raw)['pokemons'][0]
                self.assertEqual(('Lapras',131), (pokemon['species_name'],pokemon['pid']))
                self.assertTrue(pokemon['gigantamax'])
                self.assertTrue(pokemon['dynamax'])
                self.assertFalse(pokemon['costumed'])

    def test_traded_dynamax_blissey_bread_mode_enum(self):
        raw=export()
        raw['pokemons']=[{
            'id':'example-blissey','pokemonId':242,'cp':2689,
            'cpMultiplier':0.5974000096321106,
            'additionalCpMultiplier':0.19290000200271606,
            'individualAttack':15,'individualDefense':7,'individualStamina':12,
            'tradedTimeMs':1,
            'breadMoves':[{'moveLevel':2,'moveType':kind} for kind in (1,3,2)],
            'pokemonDisplay':{'alignment':0,'breadModeEnum':1,'costume':0,'formName':'Unset'}
        }]
        for value in (1,'1'):
            with self.subTest(breadModeEnum=value):
                raw['pokemons'][0]['pokemonDisplay']['breadModeEnum']=value
                pokemon=parse_pgo_json(raw)['pokemons'][0]
                self.assertEqual(('Blissey',242), (pokemon['species_name'],pokemon['pid']))
                self.assertTrue(pokemon['dynamax'])
                self.assertFalse(pokemon['gigantamax'])
        for value in (0,None,99):
            with self.subTest(breadModeEnum=value):
                raw['pokemons'][0]['pokemonDisplay']['breadModeEnum']=value
                self.assertFalse(parse_pgo_json(raw)['pokemons'][0]['dynamax'])

    def test_species_identity_and_distinct_event_counters(self):
        data=parse_pgo_json(export())
        pokemon=data['pokemons'][0]
        self.assertEqual(('Hitmonchan','100% Perfect',107),
                         (pokemon['species_name'],pokemon['nick'],pokemon['pid']))
        self.assertTrue(pokemon['purified'])
        self.assertNotEqual(data['items'][0]['name'],data['items'][1]['name'])
        self.assertEqual('event_points',data['items'][0]['category'])
        self.assertIn('EventPassPoint',data['items'][0]['raw_name'])
        self.assertIn('not a usable bag item',data['items'][0]['description'])

    def test_explicit_forms_without_guessing_from_hundo_or_cp(self):
        raw=export()
        pokemon=raw['pokemons'][0]
        pokemon['pokemonId']=6
        pokemon['cp']=4000
        normal=parse_pgo_json(raw)['pokemons'][0]
        self.assertFalse(normal['dynamax'])
        self.assertFalse(normal['gigantamax'])
        pokemon['pokemonDisplay'].update({'isDynamax':True,'isGigantamax':True,'costumeName':'PartyHat'})
        pokemon['megaLevel']=2
        tagged=parse_pgo_json(raw)['pokemons'][0]
        self.assertTrue(all(tagged[key] for key in ('dynamax','gigantamax','costumed','mega','purified')))
        self.assertFalse(tagged['mega_active'])


class HistoryAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        appearance_fixture.AppearanceTests.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        appearance_fixture.AppearanceTests.tearDownClass.__func__(cls)

    def setUp(self):
        appearance_fixture.AppearanceTests.setUp(self)
        init_assets()
        self.asset_root=Path(self.tmp.name)/'assets'
        self.asset_root.mkdir()
        self.asset_patch=patch.object(local_assets,'ASSET_ROOT',self.asset_root)
        self.asset_patch.start()
        with closing(get_db()) as db, db:
            db.executemany('INSERT INTO trainer_ownership(trainer,user_id) VALUES(?,?)',[('Ash',1),('Misty',2)])

    def tearDown(self):
        self.asset_patch.stop()
        appearance_fixture.AppearanceTests.tearDown(self)

    def history(self):
        first=export()
        second=export('2026-02-01T00:00:00Z',160)
        second['pokemons'].append({'id':'two','pokemonId':60,'cp':100,'individualAttack':15,'individualDefense':15,'individualStamina':15,'pokemonDisplay':{'shiny':True}})
        third=copy.deepcopy(second)
        third['time']='2026-03-01T01:00:00Z';third['player']['experience']=230
        third['pokemons']=third['pokemons'][1:]
        for raw in (first,second,third):ingest(raw,uid=1)

    def test_periods_ranges_and_profile_isolation(self):
        self.history()
        data=history_report(1,period='month')
        self.assertEqual(['2026-02','2026-03'],[row['period'] for row in data['records']])
        self.assertEqual(130,data['totals']['xp'])
        filtered=history_report(1,period='day',start='2026-02-01',end='2026-02-01')
        self.assertEqual((1,60),(filtered['session_count'],filtered['totals']['xp']))
        self.assertEqual('2026-W05',history_report(1,period='week')['records'][0]['period'])
        self.assertEqual(2,history_report(1,period='year')['records'][0]['sessions'])
        self.assertEqual(0,history_report(2,account='Ash')['snapshots'])
        self.assertEqual([],history_report(2)['accounts'])
        sid=data['records'][0].get('id')
        sid=history_report(1)['records'][0]['id']
        self.assertIsNone(session_detail(2,sid))
        detail=session_detail(1,sid)
        self.assertEqual('Poliwag',detail['changes']['added'][0]['name'])
        self.assertEqual(60,detail['changes']['added'][0]['pid'])

    def test_date_validation_and_timezone(self):
        self.assertEqual(0,date_bound('2026-02-01T01:00:00+01:00').hour)
        for query in ('period=bad','start=invalid','end=9999-12-31','start=2026-03-01&end=2026-02-01'):
            self.assertEqual(400,self.client.get('/api/history/report?'+query).status_code)

    def test_normal_upload_records_history_and_duplicates_do_not_create_sessions(self):
        self.assertEqual(200,self.client.post('/api/upload',json=export(),headers={'Origin':'http://localhost'}).status_code)
        newer=export('2026-02-01T00:00:00Z',160)
        response=self.client.post('/api/upload',json=newer,headers={'Origin':'http://localhost'})
        self.assertEqual('imported',response.get_json()['history']['status'])
        again=self.client.post('/api/upload',json=newer,headers={'Origin':'http://localhost'})
        self.assertEqual('duplicate',again.get_json()['history']['status'])
        self.assertEqual(1,history_report(1)['session_count'])

    def test_zero_change_export_interval_is_a_session(self):
        ingest(export(),uid=1)
        ingest(export('2026-02-01T00:00:00Z'),uid=1)
        self.assertEqual(1,history_report(1)['session_count'])
        self.assertEqual(0,history_report(1)['totals']['xp'])

    def test_export_timestamp_preserves_offset_and_fractional_seconds(self):
        from history import export_time
        self.assertEqual('2026-02-01T06:00:00.500000+00:00',
            export_time({'time':'2026-02-01T01:00:00.500-05:00'}))
        self.assertEqual('2026-02-01T05:00:00+00:00',
            export_time({'time':'2026-02-01 00:00:00 EST'}))

    def test_form_diagnostics_selects_only_own_two_highest_hundo_charizards(self):
        raw=export()
        raw['pokemons']=[dict(raw['pokemons'][0],id=str(i),pokemonId=6,cp=cp,
            individualAttack=15,individualDefense=15,individualStamina=15,
            pokemonDisplay={'isDynamax':True}) for i,cp in enumerate([2000,3000,4000])]
        raw['pokemons'].append(dict(raw['pokemons'][0],id='not-hundo',cp=5000,individualAttack=14))
        self.client.post('/api/upload',json=raw,headers={'Origin':'http://localhost'})
        data=self.client.get('/api/pokemons/form-diagnostics?pid=6').get_json()
        self.assertEqual([4000,3000],[p['cp'] for p in data['records']])
        self.assertNotIn('account',data['records'][0])
        self.assertTrue(data['records'][0]['fields']['pokemonDisplay']['isDynamax'])
        self.assertEqual(400,self.client.get('/api/pokemons/form-diagnostics?pid=no').status_code)

    def test_local_assets_catalog_and_preferences(self):
        prepare(self.asset_root)
        image=self.asset_root/'pokemon/normal/0025.png'
        image.write_bytes(b'local test fixture')
        (self.asset_root/'manifest.json').write_text(json.dumps({'pokemon:25':'pokemon/normal/0025.png','item:1':'../outside.png'}),encoding='utf-8')
        data=catalog(1)
        self.assertEqual(1,data['count'])
        self.assertIn('pokemon:25',data['overrides'])
        self.assertTrue(data['issues'])
        response=self.client.get('/local-assets/pokemon/normal/0025.png')
        self.assertEqual(200,response.status_code)
        response.close()
        self.assertIsNone(safe_asset('../outside.png'))
        self.assertIsNone(safe_asset('../profile.db'))
        response=self.client.put('/api/assets/preferences',json={'mode':'local-only'},headers={'Origin':'http://localhost'})
        self.assertEqual(200,response.status_code)
        self.assertEqual('local-only',catalog(1)['mode'])
        self.assertEqual('local-first',catalog(2)['mode'])
        self.assertEqual(401,self.app.test_client().get('/local-assets/pokemon/normal/0025.png').status_code)

    def test_asset_preparation_never_overwrites_files(self):
        prepare(self.asset_root)
        readme=self.asset_root/'README.md'
        readme.write_text('my instructions',encoding='utf-8')
        prepare(self.asset_root)
        self.assertEqual('my instructions',readme.read_text(encoding='utf-8'))
        self.assertFalse((self.asset_root/'manifest.json').exists())


if __name__=='__main__':
    unittest.main()
