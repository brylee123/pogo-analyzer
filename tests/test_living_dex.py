import json
import unittest
from contextlib import closing

import test_appearance as fixture
from database import get_db
from parser import parse_pgo_json
from living_dex import living_dex
from test_collection_history_assets import export


class LivingDexTests(unittest.TestCase):
    def test_each_national_number_is_one_entry_and_variants_overlap(self):
        rows=[{'pid':6,'form':'CharizardNormal','shiny':True,'lucky':True,'size_known':True,'xxl':True,'hundo':True},
              {'pid':6,'form':'CharizardMegaX','mega':True,'size_known':True},
              {'pid':131,'gigantamax':True,'size_known':True}]
        data=living_dex(rows)
        self.assertEqual(1025,len(data['rows']))
        charizard=next(row for row in data['rows'] if row['pid']==6)
        self.assertEqual(2,charizard['counts']['all'])
        self.assertEqual(1,charizard['counts']['shiny'])
        self.assertEqual(1,charizard['counts']['mega'])
        self.assertEqual(2,len(charizard['forms']))
        self.assertEqual(2,data['summary']['all']['owned'])
        self.assertEqual(1023,data['summary']['all']['missing'])
        self.assertEqual('Pecharunt',data['rows'][-1]['species_name'])

    def test_last_owned_specimen_removed_means_missing_again(self):
        first=living_dex([{'pid':381,'purified':True,'shiny':True}])
        second=living_dex([])
        self.assertEqual(1,first['summary']['purified']['owned'])
        self.assertEqual(0,second['summary']['purified']['owned'])
        self.assertEqual('missing',next(row for row in second['rows'] if row['pid']==381)['states']['all'])

    def test_unknown_sizes_are_not_reported_as_confirmed_missing(self):
        data=living_dex([{'pid':25,'size_known':False},{'pid':6,'size_known':True,'xxl':True}])
        pikachu=next(row for row in data['rows'] if row['pid']==25)
        self.assertEqual('unknown',pikachu['states']['xxl'])
        self.assertEqual('unknown',pikachu['states']['xxs'])
        self.assertEqual(1,data['summary']['xxl']['owned'])
        self.assertEqual(1,data['summary']['xxl']['unknown'])
        self.assertEqual(1023,data['summary']['xxl']['missing'])

    def test_special_form_catalog_excludes_unlisted_but_keeps_export_evidence(self):
        data=living_dex([{'pid':9999,'species_name':'New species','gigantamax':True}])
        bulbasaur=next(row for row in data['rows'] if row['pid']==1)
        new=next(row for row in data['rows'] if row['pid']==9999)
        self.assertEqual('not_catalogued',bulbasaur['states']['gigantamax'])
        self.assertEqual('owned',new['states']['gigantamax'])
        self.assertEqual(1,data['summary']['gigantamax']['owned'])

    def test_no_loaded_collection_has_unknown_ownership(self):
        data=living_dex([],loaded=False)
        self.assertEqual(0,data['summary']['all']['missing'])
        self.assertEqual(1025,data['summary']['all']['unknown'])

    def test_exported_size_categories_and_unhatched_eggs(self):
        raw=export()
        pokemon=raw['pokemons'][0]
        for value,xxs,xxl in ((1,True,False),('5',False,True),('XXL',False,True),(3,False,False)):
            with self.subTest(value=value):
                pokemon['size']=value
                parsed=parse_pgo_json(raw)['pokemons'][0]
                self.assertEqual((xxs,xxl),(parsed['xxs'],parsed['xxl']))
                self.assertTrue(parsed['size_known'])
        for value in (None,0,'unknown',99,True):
            pokemon['size']=value
            self.assertFalse(parse_pgo_json(raw)['pokemons'][0]['size_known'])
        raw['pokemons'].append(dict(pokemon,id='egg',isEgg=True,size=5))
        self.assertEqual(1,len(parse_pgo_json(raw)['pokemons']))


class LivingDexAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture.AppearanceTests.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        fixture.AppearanceTests.tearDownClass.__func__(cls)

    def setUp(self):
        fixture.AppearanceTests.setUp(self)

    def tearDown(self):
        fixture.AppearanceTests.tearDown(self)

    def test_current_collection_is_profile_scoped_and_history_does_not_fill_dex(self):
        raw=export()
        raw['pokemons'][0].update(pokemonId=381,isLucky=True,size=5)
        raw['pokemons'][0]['pokemonDisplay'].update(shiny=True)
        with closing(get_db()) as db,db:
            db.execute('INSERT INTO user_latest_upload(user_id,raw_json) VALUES(1,?)',(json.dumps(raw),))
            db.execute("INSERT INTO history_snapshots(user_id,account,captured_at,hash,source,raw_json) VALUES(2,'Misty','2026-01-01','history','test',?)",(json.dumps(raw),))
        first=self.client.get('/api/pokedex')
        self.assertEqual(200,first.status_code)
        self.assertEqual(1,first.get_json()['summary']['shiny']['owned'])
        self.assertEqual(1,first.get_json()['summary']['xxl']['owned'])
        second=self.other.get('/api/pokedex').get_json()
        self.assertFalse(second['loaded'])
        self.assertEqual(0,second['summary']['all']['owned'])
        self.assertEqual(401,self.app.test_client().get('/api/pokedex').status_code)

    def test_menu_and_panel_are_present(self):
        html=self.client.get('/').get_data(as_text=True)
        self.assertIn('data-tab="pokedex"',html)
        self.assertIn('id="panel-pokedex"',html)
        self.assertIn('js/pokedex-ui.js',html)


if __name__=='__main__':
    unittest.main()
