-- Category cross-reference table
-- Maps raw FIFA API category strings (multi-language) to standardized tiers

CREATE TABLE IF NOT EXISTS category_xref (
  raw_category      text PRIMARY KEY,
  display_category  text NOT NULL
);

INSERT INTO category_xref (raw_category, display_category) VALUES
-- English
('Category 1',                                              'Cat 1'),
('Category 2',                                              'Cat 2'),
('Category 3',                                              'Cat 3'),
('Category 4',                                              'Cat 4'),

-- French
('Catégorie 1',                                             'Cat 1'),
('Catégorie 2',                                             'Cat 2'),
('Catégorie 3',                                             'Cat 3'),

-- Spanish
('Categoría 1',                                             'Cat 1'),
('Categoría 2',                                             'Cat 2'),
('Categoría 3',                                             'Cat 3'),

-- Spanish — accessibility standard
('Accesibilidad estándar: categoría 1',                     'Accessible'),
('Accesibilidad estándar: categoría 2',                     'Accessible'),
('Accesibilidad estándar: categoría 3',                     'Accessible'),

-- Spanish — wheelchair accessible
('Accesibilidad y para persona en silla de ruedas: categoría 1', 'Accessible'),
('Accesibilidad y para persona en silla de ruedas: categoría 2', 'Accessible'),
('Accesibilidad y para persona en silla de ruedas: categoría 3', 'Accessible'),

-- Spanish — wheelchair companion
('Acompañante de persona en silla de ruedas: cat. 1',       'Accessible'),
('Acompañante de persona en silla de ruedas: cat. 3',       'Accessible'),

-- French — accessible standard
('Accès facile standard – Catégorie 1',                     'Accessible'),
('Accès facile standard – Catégorie 2',                     'Accessible'),

-- French — accessible adapted
('Accès facile aménagé – Catégorie',                        'Accessible'),

-- German — accessible extra
('Barrierefreier Zugang Extra – Kategorie 2',               'Accessible'),

-- German — accessible standard
('Barrierefreier Zugang Standard – Kategorie 1',            'Accessible'),
('Barrierefreier Zugang Standard – Kategorie 4',            'Accessible'),

-- Alcohol-free areas
('Alcohol-Free Area',                                       'Other'),
('Alcohol-Free Area 1',                                     'Other'),
('Alcohol-Free Area 2',                                     'Other')

ON CONFLICT (raw_category) DO UPDATE SET display_category = EXCLUDED.display_category;

-- RLS: public read (edge functions read via service role anyway, but just in case)
ALTER TABLE category_xref ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON category_xref;
CREATE POLICY "Public read" ON category_xref FOR SELECT USING (true);
