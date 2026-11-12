import { isScaleBarcode, parseScaleBarcode } from '@micropos/core';

/**
 * Real barcodes from a printed test sheet; the seed starts its catalog with one product for each.
 * The `480...` codes are Philippine EAN-13 product codes and become the product's barcode as they are.
 * The `2...` codes (last of each row on the sheet) are variable-weight scale labels: they carry a PLU and a weight,
 * so the product is a weighed one (per kg) whose code is the PLU only (see `scalePlu`); Checkout reads the PLU and
 * weight out of a scanned label. All check digits verified.
 */
export const KNOWN_BARCODES: readonly string[] = [
  '4801520204635', '4805980928421', '4804686157111', '4803050568751', '4802740643785', '2459550081706',
  '4801219239207', '4806361127495', '4808766726099', '4804824049438', '4804253550475', '2217030047808',
  '4808655427854', '4806327581170', '4809910158643', '4807877658749', '4804265272150', '2404050036701',
  '4809274314853', '4804767459073', '4803967416602', '4801305474772', '4806211005676', '2243810053806',
  '4803511403355', '4809167255010', '4808069766792', '4803832644635', '4807416428871', '2089890075709',
  '4803358275580', '4803952269732', '4806953909850', '4806106128732', '4809819762996', '2710720033506',
  '4804936214250', '4804196573845', '4804232323076', '4803837445992', '4806144588727', '2272250004109',
  '4802123666943', '4807931641267', '4802634276785', '4808695212533', '4808817276689', '2589910033301',
  '4809348828620', '4803911641623', '4809914892956', '4801559507660', '4803250465799', '2148160096704',
  '4804664003423', '4801073190591', '4808752824846', '4806468734862', '4809061366676', '2986180059008',
  '4803305652822', '4802843068812', '4807513766906', '4802145329260', '4809183593400', '2504490060608',
  '4801904351122', '4802284714910', '4803661786247', '4808027561353', '4802457938488', '2433210027402',
];

export { isScaleBarcode };

/** The PLU inside a scale label, as the product stores it (leading zeros dropped). */
export const scalePlu = (code: string): string => parseScaleBarcode(code)!.plu;

/** The weight in grams a scale label carries. */
export const scaleWeightGrams = (code: string): number => parseScaleBarcode(code)!.grams;
