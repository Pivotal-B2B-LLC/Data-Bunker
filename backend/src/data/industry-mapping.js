/**
 * Industry Mapping
 * Maps NAICS codes to LinkedIn professional categories
 */

const industryMapping = {
  // Accounting & Finance
  'Accounting': ['6920', '6924', '69201', '69202', '69203'],
  'Banking': ['6419', '64191', '64192', '64910', '64920'],
  'Financial Services': ['6499', '64991', '64992', '64999', '6619'],
  'Capital Markets': ['6612', '66120'],
  'Investment Banking': ['6630', '66301', '66302'],
  'Investment Management': ['66301', '66302', '66220'],
  'Insurance': ['6511', '6512', '6520', '6530'],
  'Venture Capital & Private Equity': ['64301', '64302', '64303'],
  
  // Retail & Consumer
  'Retail': ['4711', '4719', '4721', '4722', '4723', '4724', '4725', '4726', '4729', '4730', '4741', '4742', '4743', '4751', '4752', '4753', '4754', '4759', '4761', '4762', '4763', '4764', '4765', '4771', '4772', '4773', '4774', '4775', '4776', '4777', '4778', '4779', '4781', '4782', '4789', '4791', '4799'],
  'Supermarkets': ['4711'],
  'Apparel & Fashion': ['4771', '1411', '1412', '1413', '1414', '1419', '1420', '1431', '1439'],
  'Luxury Goods & Jewelry': ['4777', '3212', '3213'],
  'Consumer Electronics': ['4742', '4743', '2610', '2620', '2630', '2640', '2651', '2652', '2660', '2670', '2680'],
  'Consumer Goods': ['4719', '4729', '4759'],
  'Consumer Services': ['9601', '9602', '9603', '9604', '9609'],
  'Cosmetics': ['2042', '4775'],
  'Sporting Goods': ['3230', '4764'],
  
  // Food & Beverage
  'Food & Beverages': ['1011', '1012', '1013', '1020', '1031', '1032', '1039', '1041', '1042', '1051', '1052', '1061', '1062', '1071', '1072', '1073', '1081', '1082', '1083', '1084', '1085', '1086', '1089', '1091', '1092'],
  'Food Production': ['1011', '1012', '1013', '1020', '1031', '1032', '1039', '1041', '1042', '1051', '1052', '1061', '1062', '1071', '1072', '1073', '1081', '1082', '1083', '1084', '1085', '1086', '1089', '1091', '1092'],
  'Restaurants': ['5610', '5621', '5629', '5630'],
  'Dairy': ['1051', '1052'],
  'Wine & Spirits': ['1101', '1102', '1103'],
  'Tobacco': ['1200'],
  
  // Technology & Software
  'Computer Software': ['6201', '6202', '6203', '6209'],
  'Information Technology & Services': ['6201', '6202', '6203', '6209', '6311', '6312'],
  'Computer Hardware': ['2620', '2630', '2640', '2651', '2652', '2660'],
  'Computer Networking': ['6110', '6120', '6130', '6190'],
  'Computer & Network Security': ['6202', '8020'],
  'Computer Games': ['5821', '6201'],
  'Internet': ['6311', '6312', '6391', '6399'],
  'E-Learning': ['8553', '6201'],
  'Wireless': ['6110', '6120', '6130'],
  
  // Manufacturing & Industrial
  'Automotive': ['2910', '2920', '2931', '2932', '4511', '4519', '4520', '4531', '4532', '4540'],
  'Aviation & Aerospace': ['3030', '5110'],
  'Electrical/Electronic Manufacturing': ['2610', '2620', '2630', '2640', '2651', '2652', '2660', '2670', '2680', '2711', '2712', '2720', '2731', '2732', '2733', '2740', '2751', '2752'],
  'Mechanical or Industrial Engineering': ['2811', '2812', '2813', '2814', '2815', '2821', '2822', '2823', '2824', '2825', '2829', '2830', '2841', '2849', '2891', '2892', '2893', '2894', '2895', '2896', '2899'],
  'Machinery': ['2811', '2812', '2813', '2814', '2815', '2821', '2822', '2823', '2824', '2825', '2829', '2830', '2841', '2849', '2891', '2892', '2893', '2894', '2895', '2896', '2899'],
  'Chemicals': ['2011', '2012', '2013', '2014', '2015', '2016', '2017', '2020', '2030', '2041', '2042', '2051', '2052', '2053', '2059', '2060'],
  'Plastics': ['2221', '2222'],
  'Mining & Metals': ['0510', '0520', '0610', '0710', '0721', '0729', '0810', '0891', '0892', '0893', '0899', '2410', '2420', '2431', '2432', '2433', '2434', '2441', '2442', '2443', '2444', '2445', '2446', '2451', '2452', '2453', '2454'],
  'Oil & Energy': ['0610', '0620', '1910', '1920'],
  'Pharmaceuticals': ['2110', '2120'],
  'Biotechnology': ['2110', '7211'],
  'Medical Devices': ['3250'],
  'Semiconductors': ['2611'],
  'Defense & Space': ['2540', '3030'],
  
  // Construction & Real Estate
  'Construction': ['4110', '4120', '4211', '4212', '4213', '4221', '4222', '4291', '4299', '4311', '4312', '4313', '4321', '4322', '4329', '4331', '4332', '4333', '4334', '4339', '4391', '4399'],
  'Architecture & Planning': ['7111', '7112'],
  'Civil Engineering': ['4211', '4212', '4213', '4221', '4222', '4291', '4299'],
  'Real Estate': ['6810', '6820', '6831', '6832'],
  'Commercial Real Estate': ['6810', '6820'],
  'Building Materials': ['2331', '2332', '2361', '2362', '2363', '2364', '2365', '2369', '2370', '2391', '2399'],
  'Furniture': ['3101', '3102', '3103', '3109'],
  
  // Professional Services
  'Management Consulting': ['7022'],
  'Legal Services': ['6910'],
  'Law Practice': ['6910'],
  'Marketing & Advertising': ['7311', '7312', '7320'],
  'Public Relations & Communications': ['7021'],
  'Design': ['7410'],
  'Graphic Design': ['7410'],
  'Professional Training & Coaching': ['8559'],
  'Translation & Localization': ['7430'],
  'Market Research': ['7320'],
  
  // Healthcare
  'Hospital & Health Care': ['8610'],
  'Medical Practice': ['8621', '8622', '8623'],
  'Mental Health Care': ['8610', '8621'],
  'Health, Wellness & Fitness': ['9311', '9312', '9313', '9319', '9604'],
  'Alternative Medicine': ['8690'],
  'Veterinary': ['7500'],
  
  // Education
  'Higher Education': ['8530'],
  'Primary/Secondary Education': ['8510', '8520'],
  'Education Management': ['8510', '8520', '8530', '8541', '8542', '8551', '8552', '8553', '8559', '8560'],
  
  // Media & Entertainment
  'Broadcast Media': ['6010', '6020'],
  'Media Production': ['5911', '5912', '5913', '5914', '5920'],
  'Motion Pictures & Film': ['5911', '5912', '5913', '5914'],
  'Music': ['5920', '9001', '9002', '9003', '9004'],
  'Performing Arts': ['9001', '9002', '9003', '9004'],
  'Publishing': ['5811', '5812', '5813', '5814', '5819'],
  'Newspapers': ['5813'],
  'Online Media': ['6312'],
  'Animation': ['5912'],
  'Photography': ['7420'],
  'Printing': ['1811', '1812', '1813', '1814', '1820'],
  
  // Transportation & Logistics
  'Transportation/Trucking/Railroad': ['4910', '4920', '4931', '4932', '4939', '4941', '4942', '4950'],
  'Airlines/Aviation': ['5110'],
  'Logistics & Supply Chain': ['5210', '5221', '5222', '5223', '5224', '5229'],
  'Maritime': ['5010', '5020'],
  'Warehousing': ['5210'],
  'Package/Freight Delivery': ['5320'],
  'Shipbuilding': ['3011', '3012'],
  
  // Hospitality & Travel
  'Hospitality': ['5510', '5520', '5530', '5590'],
  'Leisure, Travel & Tourism': ['7911', '7912', '7990'],
  'Recreational Facilities & Services': ['9311', '9312', '9313', '9319', '9321', '9329'],
  
  // Agriculture
  'Agriculture': ['0111', '0112', '0113', '0114', '0115', '0116', '0119', '0121', '0122', '0123', '0124', '0125', '0126', '0127', '0128', '0129', '0130', '0141', '0142', '0143', '0144', '0145', '0146', '0149', '0150', '0161', '0162', '0163', '0164', '0170'],
  'Farming': ['0111', '0112', '0113', '0114', '0115', '0116', '0119'],
  'Ranching': ['0141', '0142', '0143', '0144', '0145', '0146', '0149'],
  'Fishery': ['0311', '0312', '0321', '0322'],
  
  // Government & Non-Profit
  'Government Administration': ['8411', '8412', '8413', '8421', '8422', '8423', '8424', '8425', '8430'],
  'Public Policy': ['8411', '8412', '8413'],
  'Non-Profit Organization Management': ['9411', '9412', '9420', '9491', '9492', '9499'],
  'International Affairs': ['9900'],
  'Civic & Social Organization': ['9411', '9412', '9420', '9491', '9492', '9499'],
  'Religious Institutions': ['9491'],
  'Political Organization': ['9492'],
  
  // Utilities & Environment
  'Utilities': ['3511', '3512', '3513', '3514', '3521', '3522', '3523', '3530', '3600', '3700'],
  'Renewables & Environment': ['3511', '3821', '3822', '3831', '3832', '3900'],
  'Environmental Services': ['3700', '3811', '3812', '3821', '3822', '3831', '3832', '3900'],
  
  // Telecommunications
  'Telecommunications': ['6110', '6120', '6130', '6190'],
  
  // Other
  'Textiles': ['1311', '1312', '1313', '1314', '1320', '1391', '1392', '1393', '1394', '1395', '1396', '1399'],
  'Paper & Forest Products': ['1610', '1621', '1622', '1623', '1624', '1629'],
  'Glass, Ceramics & Concrete': ['2311', '2312', '2320', '2331', '2332', '2341', '2342', '2343', '2344', '2349', '2351', '2352', '2361', '2362', '2363', '2364', '2365', '2369'],
  'Packaging & Containers': ['2221', '2222'],
  'Security & Investigations': ['8010', '8020', '8030'],
  'Facilities Services': ['8110', '8121', '8122', '8129', '8130'],
  'Staffing & Recruiting': ['7810', '7820', '7830'],
  'Events Services': ['8230'],
  'Research': ['7211', '7219', '7220'],
  'Think Tanks': ['7220'],
  'Human Resources': ['7810', '7820', '7830'],
  'Libraries': ['9101'],
  'Museums & Institutions': ['9102', '9103'],
  'Import & Export': ['4619', '4631', '4632', '4633', '4634', '4635', '4636', '4637', '4638', '4639', '4641', '4642', '4643', '4644', '4645', '4646', '4647', '4648', '4649', '4651', '4652', '4661', '4662', '4663', '4664', '4665', '4666', '4669', '4671', '4672', '4673', '4674', '4675', '4676', '4677', '4690'],
  'Wholesale': ['4611', '4612', '4613', '4614', '4615', '4616', '4617', '4618', '4619', '4621', '4622', '4623', '4624', '4631', '4632', '4633', '4634', '4635', '4636', '4637', '4638', '4639', '4641', '4642', '4643', '4644', '4645', '4646', '4647', '4648', '4649', '4651', '4652', '4661', '4662', '4663', '4664', '4665', '4666', '4669', '4671', '4672', '4673', '4674', '4675', '4676', '4677', '4690'],
  'Writing & Editing': ['9000'],
  'Gambling & Casinos': ['9200']
};

/**
 * Get LinkedIn category from NAICS code
 */
function getLinkedInCategory(naicsCode) {
  if (!naicsCode) return null;
  
  // Extract numeric part from codes like "47799 - Retail sale..."
  const codeMatch = naicsCode.match(/^(\d+)/);
  if (!codeMatch) return naicsCode; // Return original if no match
  
  const code = codeMatch[1];
  
  // Find matching LinkedIn category
  for (const [category, codes] of Object.entries(industryMapping)) {
    for (const pattern of codes) {
      if (code.startsWith(pattern)) {
        return category;
      }
    }
  }
  
  return naicsCode; // Return original if no mapping found
}

/**
 * Get all NAICS codes for a LinkedIn category
 */
function getNAICSCodesForCategory(linkedInCategory) {
  return industryMapping[linkedInCategory] || [];
}

/**
 * Get all LinkedIn categories
 */
function getLinkedInCategories() {
  return Object.keys(industryMapping).sort();
}

module.exports = {
  industryMapping,
  getLinkedInCategory,
  getNAICSCodesForCategory,
  getLinkedInCategories
};
