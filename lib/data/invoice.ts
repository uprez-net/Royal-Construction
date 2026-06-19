"use server";
import { xero, xeroTenantId } from '../xero';
import { Contact, Invoice, Invoices, LineItem } from 'xero-node';

interface InvoiceCreationInput {
    milestoneId: string; // ID of the milestone for which the invoice is being created
    date: string; // Invoice date in YYYY-MM-DD format
    dueDate: string; // Due date in YYYY-MM-DD format
    milestoneName: string; // Name of the milestone
    milestoneAmount: number; // Amount associated with the milestone
    projectId: string; // ID of the project associated with the invoice
}

/**
 * Creates a new invoice in Xero
 * @param invoiceData 
 * @returns The ID of the created invoice
 */
export async function createInvoice(invoiceData: InvoiceCreationInput): Promise<string> {
    try {
        await xero.getClientCredentialsToken();

        const contact: Contact = {
            contactID: invoiceData.projectId,
        };

        const lineItems: LineItem = {
            description: invoiceData.milestoneName,
            quantity: 1,
            unitAmount: invoiceData.milestoneAmount,
            tracking: [
                { trackingOptionID: invoiceData.milestoneId }
            ]
        };

        const invoice: Invoice = {
            type: Invoice.TypeEnum.ACCREC,
            date: invoiceData.date,
            dueDate: invoiceData.dueDate,
            reference: invoiceData.milestoneName,
            status: Invoice.StatusEnum.DRAFT,
            lineItems: [lineItems],
            contact: contact,
        };

        const invoices: Invoices = {
            invoices: [invoice]
        };

        const newInvoice = await xero.accountingApi.createInvoices(xeroTenantId, invoices, true, undefined, `Milestone ID: ${invoiceData.milestoneId}`);

        if (newInvoice.response.status !== 200) {
            throw new Error(`Failed to create invoice: ${newInvoice.response.statusText}`);
        }

        const createdInvoice = newInvoice.body.invoices?.[0];
        if (!createdInvoice || !createdInvoice.invoiceID) {
            throw new Error('Invoice creation failed, no invoice returned.');
        }

        return createdInvoice.invoiceID;
    } catch (error) {
        console.error('Error creating invoice:', error);
        throw error;
    }
}

/**
 * Get an invoice by its ID
 * @param invoiceId 
 * @returns The retrieved invoice from Xero
 */
export async function getInvoice(invoiceId: string): Promise<Invoice> {
    try {
        await xero.getClientCredentialsToken();

        const invoiceResponse = await xero.accountingApi.getInvoice(xeroTenantId, invoiceId);

        if (invoiceResponse.response.status !== 200) {
            throw new Error(`Failed to retrieve invoice: ${invoiceResponse.response.statusText}`);
        }

        const invoice = invoiceResponse.body.invoices?.[0];
        if (!invoice) {
            throw new Error(`Invoice with ID ${invoiceId} not found.`);
        }

        return invoice;
    } catch (error) {
        console.error('Error retrieving invoice:', error);
        throw error;
    }
}

/**
 * Download an invoice as a PDF from Xero
 * @param invoiceId 
 * @returns The PDF as a base64 string
 */
export async function getInvoiceAsPDF(invoiceId: string): Promise<string> {
    try {
        await xero.getClientCredentialsToken();
        const pdfResponse = await xero.accountingApi.getInvoiceAsPdf(xeroTenantId, invoiceId);

        if (pdfResponse.response.status !== 200) {
            throw new Error(`Failed to retrieve invoice PDF: ${pdfResponse.response.statusText}`);
        }

        const base64Pdf = pdfResponse.body.toString('base64'); // Return the PDF as a base64 string
        return base64Pdf;
    } catch (error) {
        console.error('Error retrieving invoice PDF:', error);
        throw error;
    }
}

/**
 * Get all invoices associated with a specific project from Xero
 * @param projectId 
 * @returns A list of invoices with pagination associated with the project
 */
export async function getInvoicesByProject(projectId: string): Promise<Invoices> {
    try {
        await xero.getClientCredentialsToken();

        const invoicesResponse = await xero.accountingApi.getInvoices(xeroTenantId, undefined, undefined, undefined, undefined, undefined, [projectId]);

        if (invoicesResponse.response.status !== 200) {
            throw new Error(`Failed to retrieve invoices by project: ${invoicesResponse.response.statusText}`);
        }

        return invoicesResponse.body;
    } catch (error) {
        console.error('Error retrieving invoices by project:', error);
        throw error;
    }
}

/**
 * Get all invoices from Xero
 * @returns A list of all invoices with pagination
 */
export async function getAllInvoices(): Promise<Invoices> {
    try {
        await xero.getClientCredentialsToken();

        const invoicesResponse = await xero.accountingApi.getInvoices(xeroTenantId);

        if (invoicesResponse.response.status !== 200) {
            throw new Error(`Failed to retrieve all invoices: ${invoicesResponse.response.statusText}`);
        }

        return invoicesResponse.body;
    } catch (error) {
        console.error('Error retrieving all invoices:', error);
        throw error;
    }
}