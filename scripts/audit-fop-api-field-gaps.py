#!/usr/bin/env python3
"""Offline, value-free audit of supplied DTS API contracts; never calls FOP."""
import argparse
import hashlib
import json
from pathlib import Path

# These are checks against the current workbench's source contracts, not guessed new FOP fields.
CHECKS = {
    'auditFulfillmentOrder': ('审核执行', [], '执行接口；不纳入查询同步，源码配置不证明部署或执行联调。'),
    'queryOrderList': ('五岗位履约主单', ['hzkj_total_amount', 'hzkj_order_amount', 'hzkj_fre_quo_amount', 'hzkj_sourcepayststus', 'hzkj_fulfillment_status', 'hzkj_purchase_status', 'hzkj_delivery_status', 'hzkj_datetimefield', 'hzkj_receipt_date', 'hzkj_logistics_info.hzkj_package_tax_fee', 'hzkj_orders_billentry.hzkj_local_sku.hzkj_sku_value', 'hzkj_order_blocked', 'hzkj_use_status'], '可补总额/运费/源单付款状态和SKU规格；包裹税费及履约原生整单出库字段逐项检查，不能用表头税费或发运状态替代。'),
    'queryOrderDetail': ('履约定向核查', ['hzkj_total_amount', 'hzkj_fre_quo_amount', 'hzkj_sourcepayststus', 'hzkj_delivery_status', 'hzkj_logistics_info.hzkj_package_tax_fee'], '按ID查询，不能将列表已提供的字段视为详情也已提供。'),
    'queryStockOrder': ('销售/采购备货', ['billstatus', 'hzkj_orderstatus', 'hzkj_order_amount', 'hzkj_settlecurrency.number', 'hzkj_currency.number', 'hzkj_operator.id', 'hzkj_orders_billentry.hzkj_local_sku.hzkj_sku_value'], '金额可取订单金额；hzkj_currency是本位币，不能替代结算币种。'),
    'queryAfterSaleOrders': ('RMA', ['hzkj_order_amount', 'hzkj_refund_amount', 'hzkj_tocurr.number', 'hzkj_srcnumber', 'hzkj_operator.id', 'org.id'], '可补本单金额/退款/币种；必填付款客户ID，不构成公司全量同步入口；归属需本地验证原单关联。'),
    'queryAllocation': ('待配货/审核/已配货', ['hzkj_order_id', 'billstatus', 'hzkj_alloc_status', 'hzkj_alloc_entry.hzkj_src_entry_number', 'hzkj_alloc_entry.hzkj_line_ready_qty', 'hzkj_alloc_entry.hzkj_line_alloc_qty', 'hzkj_alloc_entry.hzkj_line_short_qty', 'org.id'], '提供配货状态、审核及逐行需求/齐套/短缺事实；原单和分录关联仍需验证，不能按SKU猜配。'),
    'queryDispatch': ('待履约/已履约/仓库发运事实', ['hzkj_delivery_status', 'hzkj_fulfillment_status', 'hzkj_ship_block_state', 'hzkj_order_no', 'hzkj_logistics_channel1.number', 'hzkj_logistics_channel1.name', 'hzkj_basedatafield.number', 'hzkj_logistics_orderno', 'hzkj_logistics_trackno'], '可补实际渠道、两类跟踪号和发运状态；本单取消状态不能反推履约取消。'),
    'queryDeliveryNotice': ('仓库发货通知/业务链', ['id', 'billno', 'org.id', 'hzkj_deliver_billno', 'hzkj_intercept_cancelled', 'entryentity.id', 'entryentity.hzkj_entry_billno', 'entryentity.hzkj_sale_order_rowno'], '提供通知主单及明细关联候选；通知进度不直接代替履约整单出库。'),
    'queryDeliveryNoticeByNo': ('发货通知明细补查', ['id', 'billno', 'org.id', 'entryentity.id', 'entryentity.hzkj_entry_billno', 'entryentity.hzkj_sale_order_rowno'], '仅返回分录与来源号；缺主单ID/编号/组织，不能单独形成完整主单副本。'),
    'queryFreightException': ('货代异常通知候选', ['id', 'billno', 'billstatus', 'modifytime', 'createtime', 'hzkj_order_no', 'hzkj_sale_order_no', 'hzkj_issue_detail', 'hzkj_send_status', 'org.id', 'hzkj_bizoperator.id', 'hzkj_inner_no', 'hzkj_transfer_no'], '发送状态是通知发送状态，不是发运SYNC_FAILED或异常已解决状态；仅销售单号过滤，缺公司及归属回显，需受控范围与唯一原单核验后才能展示。'),
    'queryPurchase': ('采购分组/待发货', ['billstatus', 'hzkj_pay_status', 'hzkj_paystatus', 'hzkj_logisticsstatus', 'hzkj_ship_status', 'hzkj_refund_amount', 'hzkj_supplier.id', 'hzkj_supplier.name', 'hzkj_billentry.hzkj_salbillid', 'hzkj_billentry.hzkj_salbillentryid', 'hzkj_warehouse_all.name'], '采购原生状态可补，1688付款/标准付款/供应商发货仍分别判断；采购退款金额不代表实物退货。'),
    'queryPurchaseRequisition': ('采购申请/原单关联', ['billstatus', 'hzkj_cancelstatus', 'entryentity.hzkj_srcbillentity', 'entryentity.hzkj_srcbillid', 'entryentity.hzkj_srcbillentryid', 'entryentity.hzkj_salbillid', 'entryentity.hzkj_salbillentryid', 'entryentity.hzkj_procurement_status'], '补采购申请与履约原单关系；申请进度不等于供应商付款成功。'),
    'queryPurchaseReturn': ('采购退款候选；不归实物退货清单', ['id', 'billno', 'hzkj_pay_status', 'hzkj_refund_amount', 'hzkj_1688_order_n', 'hzkj_biztime', 'org.id', 'entryentity.id'], '实际实体hzkj_purorderbill；固定1688状态3/4，七字段采购订单退款候选，没有实物单据、行、退货进度或归属证明。'),
    'queryPurchaseRefundApplication': ('采购退款申请；不归实物退货清单', ['id', 'billno', 'billstatus', 'hzkj_cancelstatus', 'entryentity.id', 'entryentity.hzkj_srcbillentity', 'entryentity.hzkj_srcbillid', 'entryentity.hzkj_srcbillentryid', 'entryentity.hzkj_qty', 'hzkj_rf_kind', 'entryentity.hzkj_rf_applyqty', 'hzkj_rf_submitstate', 'hzkj_rf_totalamt', 'hzkj_settlecurrency.number', 'org.id'], '提供申请头/原单分录候选；源码实物申请量为hzkj_rf_applyqty，通用hzkj_qty不得替代。未返回退款类型、真实退货执行状态与物流。'),
    'queryReceiptNotice': ('待入库/收货通知', ['id', 'billno', 'billstatus', 'hzkj_receiptnotice_status', 'hzkj_ware_house.name', 'hzkj_providersupplier.name', 'hzkj_logistics_company', 'hzkj_waybill_number', 'entryentity.hzkj_receiveqty', 'entryentity.hzkj_srcbillid', 'entryentity.hzkj_srcbillentryid', 'entryentity.entryentity_lk.entryentity_lk_sid'], '已收货数量不直接冒充已入库；国内物流及源采购行可补，通知本单仓库/供应商仍缺对应输出。'),
    'queryInbound': ('入库事实/业务链', ['id', 'billstatus', 'org.id', 'billentry.id', 'billentry.qty', 'billentry.srcbillentity', 'billentry.srcbillid', 'billentry.srcbillentryid', 'billentry.warehouse.id', 'billentry.material.id'], '提供原单及行、数量/仓库；需核验审核/冲销/有效性及唯一关联后计算入库，不凭列表返回即视为已入库。'),
    'queryOutbound': ('定向出库事实', ['id', 'billstatus', 'org.id', 'billentry.id', 'billentry.qty', 'billentry.srcbillentity', 'billentry.srcbillid', 'billentry.srcbillentryid', 'billentry.warehouse.id'], '仅必填出库ID，不能据此完成公司范围全量出库采集。'),
    'queryOutboundList': ('出库事实/业务链', ['id', 'billstatus', 'org.id', 'isvirtualbill', 'billentry.id', 'billentry.qty', 'billentry.srcbillentity', 'billentry.srcbillid', 'billentry.srcbillentryid', 'billentry.material.id'], '补公司范围出库查询入口，仍需排除虚拟/冲销/无效行并验证原单关系；不替代履约原生状态回写。'),
    'queryPayment': ('采购付款事实', ['hzkj_purorder_no', 'hzkj_purchase_id', 'hzkj_pay_status', 'hzkj_paydate', 'hzkj_actpayamt', 'hzkj_cancelstatus', 'hzkj_refund_amount'], '提供付款与采购来源事实；款项和币种须本单校验，退款与实物退货分开。'),
    'queryReceipt': ('收款事实/业务链', ['hzkj_receive_status', 'hzkj_void_status', 'entryentity.hzkj_src_order', 'entryentity.hzkj_samount', 'entryentity.hzkj_freight', 'entryentity.hzkj_amountfield', 'entryentity.hzkj_fixed_tax_fee'], '保留收款事实；按现行待办金额契约不再用收款分录替补履约待办金额。'),
    'queryReceiptAdjustment': ('收款调整事实/业务链', ['billstatus', 'hzkj_adjust_amount', 'hzkj_entryentity.hzkj_order_bill', 'hzkj_entryentity.hzkj_sales_order_number', 'hzkj_entryentity.hzkj_adjust_status'], '提供调整事实；不将已调整自动视为原单状态或到账结果，不在日志输出账户信息。'),
    'queryCustomerRegistrations': ('客户注册统计', ['id', 'createtime', 'createorg.id', 'hzkj_biz_user.id'], '注册事件按客户创建时间取数；归属ID、本地权限及窗口需要独立核验，不借订单创建时间。'),
    'queryWorkbenchInventoryBalance': ('即时库存', ['org.id', 'material.id', 'warehouse.id', 'qty', 'baseqty'], '必填组织及物料；独立即时读取，不能当已锁库或可预占成功，也不以快照代表当前可用。'),
    'queryWorkbenchAllocationBalance': ('配货占用库存', ['org.id', 'hzkj_material.id', 'hzkj_warehouse.id', 'hzkj_customer.id', 'hzkj_occ_qty'], '提供物料/仓库/客户占用；缺可用库存证明，不直接反推可配货数量。'),
    'queryWorkbenchReservedStock': ('客户备货可用/锁定', ['org.id', 'hzkj_customer.id', 'hzkj_local_sku.id', 'hzkj_warehouse.id', 'hzkj_total_available_qty', 'hzkj_lock_qty', 'hzkj_deposit_avail_qty', 'hzkj_deposit_lock_qty'], '必填客户及组织；区分全款/定金可用与锁定，不自动执行预占。'),
    'queryWorkbenchSkuMaterial': ('SKU物料关系', ['id', 'number', 'hzkj_material.id', 'hzkj_material.number', 'hzkj_org_data.number'], '按SKU编码及组织编码查询，提供明确物料映射；不按名称猜关联。'),
}


def audit(directory):
    result = []
    for path in sorted(directory.glob('*.dts')):
        raw = path.read_bytes()
        data = json.loads(raw.decode('utf-8').split('@ISC@', 1)[1])[0]
        name = data['number']
        use, checks, conclusion = CHECKS[name]
        response = {row['respobjpropname']: row for row in data.get('respentryentity', [])}
        if name.startswith('query') and not response:
            raise ValueError(f'missing_response_contract:{name}')
        result.append({
            'operation': name, 'sourceFile': path.name, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
            'entity': data.get('bizobject_id'), 'path': data.get('urlformat'), 'operationType': data.get('operation'),
            'intendedUse': use,
            'parameters': [{'name': row['paramname'], 'required': row.get('must') == '1', 'sourceField': row.get('objpropname')} for row in data.get('bodyentryentity', [])],
            'responseFieldCount': len(response),
            'presentCheckedFields': [{'field': field, 'responseName': response[field].get('respparamname'), 'description': response[field].get('respdes', {}).get('zh_CN')} for field in checks if field in response],
            'missingCheckedFields': [field for field in checks if field not in response],
            'conclusion': conclusion, 'verificationLevel': 'supplied_api_configuration_only',
            'liveResponseVerified': False, 'physicalReturnIntegration': False,
        })
    if {row['operation'] for row in result} != set(CHECKS):
        raise ValueError('expected_complete_26_operation_package')
    return {
        'schemaVersion': 1, 'auditDate': '2026-11-16', 'method': 'DTS body after @ISC@, JSON[0]; no network or database access',
        'operationCount': len(result), 'automaticCallsEnabled': False, 'databaseWritten': False,
        'limits': ['字段配置提供不等于真实响应包含值，不证明部署或采集完成。', '来源主键、原单关联、组织和当前账号权限仍按本地事实核验；未知保留未知。', '时间窗口与稳定分页由独立时间增量审计负责；本记录不宣称任何接口已支持完整增量。'],
        'fopSourceEvidence': [
            {'file': 'code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/einkauf/service/PurchaseRefundApplicationService.java', 'symbols': ['ENTITY', 'initializeDraft', 'validateSources'], 'finding': 'REFUND_ONLY与RETURN_REFUND分离，实物申请数量为hzkj_rf_applyqty，默认审批核验未接通时阻止提交/审核。'},
            {'file': 'code/crm/hzkj-dtr5b-crm/src/main/java/hzkj/dtr5b/crm/logistics/exception/FreightExceptionService.java', 'symbols': ['ENTITY', 'findDelivery', 'manualDeliveryValues'], 'finding': '异常通知按当前组织唯一发运单带出销售单号及归属；发送是独立通知动作，不等于发运同步状态。'},
        ],
        'operations': result,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(audit(args.input), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'operations': 26, 'output': str(args.output), 'liveCalls': 0}))
