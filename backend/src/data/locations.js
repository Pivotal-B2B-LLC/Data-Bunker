/**
 * Comprehensive location data for filtering
 * Provides complete lists of countries, states, and cities
 */

const locations = {
  'United States': {
    'Alabama': ['Birmingham', 'Montgomery', 'Mobile', 'Huntsville', 'Tuscaloosa'],
    'Alaska': ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan'],
    'Arizona': ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Glendale', 'Gilbert', 'Tempe'],
    'Arkansas': ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro'],
    'California': ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim', 'Santa Ana', 'Riverside', 'Stockton', 'Irvine', 'Chula Vista', 'Fremont', 'San Bernardino', 'Modesto', 'Fontana', 'Santa Clarita', 'Oxnard', 'Moreno Valley', 'Glendale', 'Huntington Beach', 'Santa Rosa', 'Oceanside', 'Garden Grove', 'Ontario', 'Elk Grove', 'Corona', 'Lancaster', 'Palmdale', 'Salinas', 'Hayward', 'Sunnyvale', 'Pasadena', 'Torrance', 'Escondido', 'Orange', 'Fullerton', 'Thousand Oaks', 'Visalia', 'Simi Valley', 'Concord', 'Roseville', 'Santa Clara', 'Vallejo', 'Victorville', 'Berkeley', 'Fairfield'],
    'Colorado': ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Pueblo', 'Centennial', 'Boulder'],
    'Connecticut': ['Bridgeport', 'New Haven', 'Stamford', 'Hartford', 'Waterbury', 'Norwalk', 'Danbury'],
    'Delaware': ['Wilmington', 'Dover', 'Newark'],
    'Florida': ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Tallahassee', 'Fort Lauderdale', 'Port St. Lucie', 'Cape Coral', 'Pembroke Pines', 'Hollywood', 'Miramar', 'Gainesville', 'Coral Springs', 'Miami Gardens', 'Clearwater', 'Palm Bay', 'Pompano Beach', 'West Palm Beach'],
    'Georgia': ['Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah', 'Athens', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Albany'],
    'Hawaii': ['Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe'],
    'Idaho': ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello', 'Caldwell'],
    'Illinois': ['Chicago', 'Aurora', 'Rockford', 'Joliet', 'Naperville', 'Springfield', 'Peoria', 'Elgin', 'Waukegan', 'Cicero'],
    'Indiana': ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Bloomington', 'Fishers'],
    'Iowa': ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo'],
    'Kansas': ['Wichita', 'Overland Park', 'Kansas City', 'Olathe', 'Topeka', 'Lawrence'],
    'Kentucky': ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington'],
    'Louisiana': ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles'],
    'Maine': ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn'],
    'Maryland': ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Bowie', 'Hagerstown', 'Annapolis'],
    'Massachusetts': ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'Brockton', 'New Bedford', 'Quincy', 'Lynn', 'Newton', 'Somerville'],
    'Michigan': ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Flint', 'Dearborn', 'Livonia'],
    'Minnesota': ['Minneapolis', 'St. Paul', 'Rochester', 'Duluth', 'Bloomington', 'Brooklyn Park', 'Plymouth'],
    'Mississippi': ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi'],
    'Missouri': ['Kansas City', 'St. Louis', 'Springfield', 'Independence', 'Columbia', 'Lee\'s Summit', 'O\'Fallon'],
    'Montana': ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte'],
    'Nebraska': ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island'],
    'Nevada': ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City'],
    'New Hampshire': ['Manchester', 'Nashua', 'Concord', 'Derry', 'Rochester'],
    'New Jersey': ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Edison', 'Woodbridge', 'Lakewood', 'Toms River', 'Hamilton', 'Trenton'],
    'New Mexico': ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell'],
    'New York': ['New York City', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse', 'Albany', 'New Rochelle', 'Mount Vernon', 'Schenectady', 'Utica', 'White Plains', 'Troy', 'Niagara Falls', 'Binghamton'],
    'North Carolina': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord', 'Greenville', 'Asheville'],
    'North Dakota': ['Fargo', 'Bismarck', 'Grand Forks', 'Minot'],
    'Ohio': ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain'],
    'Oklahoma': ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Lawton', 'Edmond'],
    'Oregon': ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford'],
    'Pennsylvania': ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg'],
    'Rhode Island': ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'East Providence'],
    'South Carolina': ['Columbia', 'Charleston', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville', 'Summerville'],
    'South Dakota': ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings'],
    'Tennessee': ['Memphis', 'Nashville', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro'],
    'Texas': ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Laredo', 'Lubbock', 'Garland', 'Irving', 'Amarillo', 'Grand Prairie', 'McKinney', 'Frisco', 'Brownsville', 'Pasadena', 'Mesquite', 'Killeen', 'McAllen', 'Waco', 'Carrollton', 'Denton', 'Midland', 'Abilene', 'Beaumont', 'Round Rock', 'Odessa', 'Wichita Falls', 'Richardson', 'Lewisville', 'Tyler', 'College Station', 'Pearland', 'San Angelo'],
    'Utah': ['Salt Lake City', 'West Valley City', 'Provo', 'West Jordan', 'Orem', 'Sandy', 'Ogden', 'St. George'],
    'Vermont': ['Burlington', 'Essex', 'South Burlington', 'Colchester'],
    'Virginia': ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Newport News', 'Alexandria', 'Hampton', 'Roanoke', 'Portsmouth', 'Suffolk'],
    'Washington': ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Spokane Valley', 'Federal Way'],
    'West Virginia': ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling'],
    'Wisconsin': ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Eau Claire', 'Oshkosh'],
    'Wyoming': ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs']
  },
  'United Kingdom': {
    'England': ['London', 'Birmingham', 'Manchester', 'Leeds', 'Liverpool', 'Newcastle', 'Sheffield', 'Bristol', 'Nottingham', 'Leicester', 'Southampton', 'Brighton', 'Plymouth', 'Oxford', 'Cambridge', 'York', 'Bath', 'Chester', 'Canterbury', 'Winchester', 'Durham', 'Exeter', 'Norwich', 'Portsmouth', 'Reading', 'Coventry', 'Bradford', 'Derby', 'Stoke-on-Trent', 'Wolverhampton', 'Sunderland'],
    'Scotland': ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Inverness', 'Stirling', 'Perth'],
    'Wales': ['Cardiff', 'Swansea', 'Newport', 'Wrexham', 'Barry'],
    'Northern Ireland': ['Belfast', 'Londonderry', 'Lisburn', 'Newry']
  },
  'Canada': {
    'Ontario': ['Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton', 'London', 'Markham', 'Vaughan', 'Kitchener', 'Windsor'],
    'Quebec': ['Montreal', 'Quebec City', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke'],
    'British Columbia': ['Vancouver', 'Surrey', 'Burnaby', 'Richmond', 'Abbotsford', 'Coquitlam', 'Victoria', 'Kelowna'],
    'Alberta': ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge', 'St. Albert', 'Medicine Hat'],
    'Manitoba': ['Winnipeg', 'Brandon', 'Steinbach'],
    'Saskatchewan': ['Saskatoon', 'Regina', 'Prince Albert'],
    'Nova Scotia': ['Halifax', 'Sydney', 'Dartmouth'],
    'New Brunswick': ['Moncton', 'Saint John', 'Fredericton'],
    'Newfoundland and Labrador': ['St. John\'s', 'Mount Pearl', 'Corner Brook'],
    'Prince Edward Island': ['Charlottetown', 'Summerside']
  },
  'Afghanistan': {
    'Kabul': ['Kabul', 'Bagrami', 'Qarabagh', 'Paghman', 'Shakardara', 'Mir Bacha Kot', 'Kalakan'],
    'Badakhshan': ['Faizabad', 'Baharak', 'Ragh', 'Ishkashim', 'Jurm', 'Keshm'],
    'Badghis': ['Qala-i-Naw', 'Ghormach', 'Bala Murghab'],
    'Baghlan': ['Baghlan', 'Puli Khumri', 'Nahrin', 'Khanabad', 'Doshi', 'Taliqan'],
    'Balkh': ['Mazar-i-Sharif', 'Keleft', 'Sholgara', 'Balkh', 'Nawabad', 'Chimtal'],
    'Bamyan': ['Bamyan', 'Waras', 'Panjab', 'Saighan'],
    'Daykundi': ['Nili', 'Khas Uruzgan', 'Shahidan'],
    'Faryab': ['Maimana', 'Andkhoy', 'Khwaja Sabz Posh', 'Pashtun Kot'],
    'Farah': ['Farah', 'Lash Gah', 'Anar Darreh', 'Bakwa', 'Bala Baluk'],
    'Faryab': ['Maimana', 'Andkhoy', 'Almar', 'Thorghundi'],
    'Ghazni': ['Ghazni', 'Gelan', 'Muqur', 'Jaghatu', 'Deh Yak', 'Nawa'],
    'Ghor': ['Chaghcharan', 'Firuz Kuh', 'Taywara'],
    'Helmand': ['Lashkargah', 'Kandahar', 'Naw Zad', 'Sangin', 'Musa Qala'],
    'Herat': ['Herat', 'Guzarah', 'Injil', 'Kala-e Naw', 'Chesht-e Sharif'],
    'Jowzjan': ['Sheberghan', 'Aqcha', 'Aybak', 'Faizabad'],
    'Kandahar': ['Kandahar', 'Spin Boldak', 'Arghandab', 'Dand', 'Panjwai'],
    'Kapisa': ['Mahmud-i-Raqi', 'Tagab', 'Kapisa', 'Kohestan'],
    'Khost': ['Khost', 'Matun', 'Sabari', 'Shaul', 'Tani'],
    'Kunar': ['Asadabad', 'Chawkay', 'Dangam', 'Nari', 'Pech'],
    'Kunduz': ['Kunduz', 'Aliabad', 'Khanabad', 'Archi'],
    'Laghman': ['Mihtarlam', 'Alingar', 'Alishang'],
    'Logar': ['Pule Alam', 'Baraki Barak', 'Mohammad Agha', 'Kharwar'],
    'Nurestan': ['Parun', 'Wama', 'Barikot'],
    'Paktia': ['Gardez', 'Lajmangal', 'Parachinar', 'Sharana', 'Jani Khel'],
    'Paktika': ['Sharan', 'Waza Khwa', 'Orgun', 'Sarobi'],
    'Panjshir': ['Bazarak', 'Paryan', 'Rukha', 'Kalu'],
    'Parwan': ['Charikar', 'Bagram', 'Ghorband', 'Salang', 'Surobi'],
    'Samangan': ['Aybak', 'Dara-i Suf', 'Khulm'],
    'Sar-e Pul': ['Sar-e Pul', 'Sang Charak', 'Kohistanat'],
    'Takhar': ['Taluqan', 'Yangi Qala', 'Taloqan', 'Khwaja Ghar'],
    'Uruzgan': ['Tirin', 'Deh Rawud', 'Khas Uruzgan'],
    'Wardak': ['Maidan Shahr', 'Chaki Wardak', 'Syed Abad'],
    'Zabul': ['Qalat', 'Spin Boldak', 'Dai Chopan']
  },
  'India': {
    'Delhi': ['Delhi', 'New Delhi', 'South Delhi', 'East Delhi', 'West Delhi', 'North Delhi'],
    'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Thane', 'Aurangabad', 'Kolhapur', 'Solapur'],
    'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Salem', 'Tiruppur', 'Erode', 'Kanchipuram'],
    'Karnataka': ['Bangalore', 'Mysore', 'Mangalore', 'Hubli', 'Belgaum', 'Davangere'],
    'Telangana': ['Hyderabad', 'Secunderabad', 'Warangal', 'Nizamabad', 'Karimnagar'],
    'Rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Ajmer', 'Kota', 'Bikaner', 'Alwar'],
    'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Meerut', 'Ghaziabad', 'Allahabad', 'Noida'],
    'West Bengal': ['Kolkata', 'Darjeeling', 'Siliguri', 'Durgapur', 'Asansol'],
    'Gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Baroda', 'Bhavnagar'],
    'Punjab': ['Chandigarh', 'Amritsar', 'Ludhiana', 'Jalandhar', 'Patiala']
  },
  'Pakistan': {
    'Sindh': ['Karachi', 'Hyderabad', 'Sukkur', 'Larkana', 'Nawabshah'],
    'Punjab': ['Lahore', 'Faisalabad', 'Multan', 'Rawalpindi', 'Bahawalpur', 'Sargodha', 'Gujranwala'],
    'Khyber Pakhtunkhwa': ['Peshawar', 'Abbottabad', 'Mardan', 'Kohat', 'Mansehra'],
    'Balochistan': ['Quetta', 'Ziarat', 'Loralai', 'Kalat'],
    'Gilgit-Baltistan': ['Gilgit', 'Skardu', 'Hunza']
  },
  'Bangladesh': {
    'Dhaka': ['Dhaka', 'Narayanganj', 'Gazipur', 'Sherpur', 'Tangail'],
    'Chittagong': ['Chittagong', 'Comilla', 'Sylhet', 'Bandarban'],
    'Khulna': ['Khulna', 'Jessore', 'Barisal'],
    'Rajshahi': ['Rajshahi', 'Bogra', 'Dinajpur', 'Rangpur']
  },
  'Germany': {
    'North Rhine-Westphalia': ['Cologne', 'Düsseldorf', 'Dortmund', 'Essen', 'Duisburg', 'Bonn'],
    'Bavaria': ['Munich', 'Nuremberg', 'Augsburg', 'Regensburg', 'Ingolstadt'],
    'Baden-Württemberg': ['Stuttgart', 'Mannheim', 'Heidelberg', 'Karlsruhe', 'Ulm'],
    'Berlin': ['Berlin'],
    'Hesse': ['Frankfurt', 'Wiesbaden', 'Offenbach'],
    'Hamburg': ['Hamburg'],
    'Saxony': ['Dresden', 'Leipzig', 'Chemnitz']
  },
  'France': {
    'Île-de-France': ['Paris', 'Versailles', 'Boulogne-Billancourt'],
    'Provence-Alpes-Côte d\'Azur': ['Marseille', 'Nice', 'Cannes', 'Toulon'],
    'Auvergne-Rhône-Alpes': ['Lyon', 'Grenoble', 'Saint-Étienne', 'Villeurbanne'],
    'Hauts-de-France': ['Lille', 'Roubaix', 'Arras'],
    'Nouvelle-Aquitaine': ['Bordeaux', 'Toulouse', 'Limoges']
  },
  'Australia': {
    'New South Wales': ['Sydney', 'Newcastle', 'Wollongong', 'Central Coast'],
    'Victoria': ['Melbourne', 'Geelong', 'Ballarat', 'Bendigo'],
    'Queensland': ['Brisbane', 'Gold Coast', 'Sunshine Coast', 'Cairns', 'Townsville'],
    'Western Australia': ['Perth', 'Fremantle', 'Mandurah'],
    'South Australia': ['Adelaide', 'Gawler'],
    'Tasmania': ['Hobart', 'Launceston'],
    'Australian Capital Territory': ['Canberra']
  },
  'Japan': {
    'Tokyo': ['Tokyo', 'Shinjuku', 'Shibuya', 'Minato'],
    'Osaka': ['Osaka', 'Kobe', 'Kyoto'],
    'Aichi': ['Nagoya', 'Toyota'],
    'Fukuoka': ['Fukuoka', 'Kitakyushu'],
    'Kanagawa': ['Yokohama', 'Kawasaki']
  },
  'China': {
    'Beijing': ['Beijing', 'Chaoyang', 'Dongcheng'],
    'Shanghai': ['Shanghai', 'Pudong', 'Huangpu'],
    'Guangdong': ['Guangzhou', 'Shenzhen', 'Foshan', 'Dongguan'],
    'Sichuan': ['Chengdu', 'Mianyang'],
    'Zhejiang': ['Hangzhou', 'Ningbo', 'Wenzhou'],
    'Jiangsu': ['Nanjing', 'Suzhou', 'Wuxi']
  },
  'Mexico': {
    'Mexico City': ['Mexico City', 'Benito Juárez'],
    'State of Mexico': ['Toluca', 'Ecatepec'],
    'Jalisco': ['Guadalajara', 'Puerto Vallarta', 'Zapopan'],
    'Nuevo León': ['Monterrey', 'San Pedro Garza García'],
    'Veracruz': ['Veracruz', 'Xalapa'],
    'Quintana Roo': ['Cancún', 'Playa del Carmen']
  },
  'Brazil': {
    'São Paulo': ['São Paulo', 'Campinas', 'Santos'],
    'Rio de Janeiro': ['Rio de Janeiro', 'Niterói', 'Duque de Caxias'],
    'Minas Gerais': ['Belo Horizonte', 'Contagem', 'Betim'],
    'Bahia': ['Salvador', 'Feira de Santana', 'Vitória da Conquista'],
    'Rio Grande do Sul': ['Porto Alegre', 'Caxias do Sul']
  }
};

module.exports = locations;
