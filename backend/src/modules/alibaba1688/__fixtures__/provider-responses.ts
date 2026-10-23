import type {
  Alibaba1688DetailProviderResponse,
  Alibaba1688ImageProviderResponse,
  Alibaba1688ImageUploadProviderResponse,
  Alibaba1688KeywordProviderResponse,
} from '../alibaba1688.types'

export const keywordProviderFixture: Alibaba1688KeywordProviderResponse = {
  _aop_response_id: 'keyword-request-1',
  traceId: 'keyword-trace-1',
  result: {
    success: true,
    code: '200',
    message: 'success',
    result: {
      totalRecords: 1,
      totalPage: 1,
      pageSize: 20,
      currentPage: 1,
      data: [{
        offerId: 1234567890123,
        subject: '便携式宠物饮水杯',
        subjectTrans: 'Portable Pet Water Bottle',
        imageUrl: 'https://cbu01.alicdn.com/img/ibank/pet-bottle.jpg',
        isJxhy: true,
        isOnePsale: true,
        minOrderQuantity: 1,
        monthSold: 326,
        repurchaseRate: '18%',
        tradeScore: '4.8',
        sellerIdentities: ['super_factory', 'tp_member'],
        offerIdentities: ['yx'],
        priceInfo: {
          price: '12.80',
          consignPrice: '13.50',
          jxhyPrice: '12.20',
          promotionPrice: '11.90',
        },
        sellerDataInfo: {
          tradeMedalLevel: '5',
          compositeServiceScore: '4.7',
          logisticsExperienceScore: '4.8',
          repeatPurchasePercent: '0.34',
        },
      }],
    },
  },
}
export const imageProviderFixture: Alibaba1688ImageProviderResponse = {
  _aop_response_id: 'image-request-1',
  trace_id: 'image-trace-1',
  result: {
    success: 'true',
    code: '200',
    message: 'success',
    result: {
      totalRecords: 1,
      totalPage: 1,
      pageSize: 10,
      currentPage: 2,
      data: [{
        offerId: '998877665544',
        subject: '硅胶厨房收纳盒',
        imageUrl: 'https://cbu01.alicdn.com/img/ibank/storage-box.jpg',
        minOrderQuantity: 2,
        priceInfo: { consignPrice: '8.88' },
      }],
    },
  },
}

export const imageUploadProviderFixture: Alibaba1688ImageUploadProviderResponse = {
  _aop_response_id: 'image-upload-request-1',
  traceId: 'image-upload-trace-1',
  result: {
    success: true,
    code: '200',
    message: 'success',
    result: 'image-1688-1',
  },
}

export const detailProviderFixture: Alibaba1688DetailProviderResponse = {
  _aop_response_id: 'detail-request-1',
  traceId: 'detail-trace-1',
  result: {
    success: true,
    code: '200',
    message: 'success',
    result: {
      offerId: '1234567890123',
      categoryId: '201339509',
      categoryName: '宠物饮水用品',
      subject: '便携式宠物饮水杯',
      subjectTrans: 'Portable Pet Water Bottle',
      descriptionTrans: 'Portable leak-proof bottle for outdoor walks.',
      productImage: {
        images: [
          'https://cbu01.alicdn.com/img/ibank/pet-bottle-1.jpg',
          'https://cbu01.alicdn.com/img/ibank/pet-bottle-2.jpg',
        ],
        whiteImage: 'https://cbu01.alicdn.com/img/ibank/pet-bottle-white.jpg',
      },
      productSkuInfos: [{
        skuId: '10001',
        specId: 'blue-350ml',
        amountOnSale: 500,
        price: '12.80',
        consignPrice: '13.50',
        skuAttributes: [{ attributeName: '颜色', attributeValue: '蓝色' }],
      }],
      minOrderQuantity: 1,
      status: 'published',
      soldOut: '2350',
      tradeScore: '4.8',
      sellingPoint: ['防漏', '便携'],
      sellerOpenId: 'seller-open-id-1',
      companyName: '杭州示例宠物用品有限公司',
      offerIdentities: ['super_factory', 'tp_member'],
      sellerDataInfo: {
        tradeMedalLevel: '5',
        compositeServiceScore: '4.7',
        logisticsExperienceScore: '4.8',
        repeatPurchasePercent: '0.34',
      },
      promotionUrl: 'https://detail.1688.com/offer/1234567890123.html',
    },
  },
}
