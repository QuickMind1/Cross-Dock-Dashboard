import { GO_SERVER_BASE_URL, RECIPIENT_MOCKUP } from '../config.mjs';

export async function SendWarningEmail(bearerToken, warning, tripID) {
    const url = `${GO_SERVER_BASE_URL}/api/alerts/email`;

    const emailData = WarningEmailFactory[warning] || WarningEmailFactory["default"];
    const { subject, message } = emailData(tripID, warning);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: RECIPIENT_MOCKUP,
                subject: subject,
                message: message,
                trip_id: tripID,
            })
        });
    
        const body = await response.json();
    
        if (!response.ok || !body.ok) throw new Error(body.error || "API Error");

        return true;
    } catch (error) {
        console.error(`Failed to send email for trip ${tripID}:`, error);
        return false;
    }
}

export async function SendWarningEmails(bearerToken, tripsList) {
    const warningTrips = tripsList.filter(t => t.warning);
    let successCount = 0;

    for (const trip of warningTrips) {
        const success = await SendWarningEmail(bearerToken, trip.warning, trip.id);
        if (success) successCount++;
    }

    return { attempted: warningTrips.length, succeeded: successCount };
}


const WarningEmailFactory = {
    "Request no atendida": (tripID) => ({
        subject: `ALERTA: Solicitud de viaje sin asignar ${tripID}`,
        message: `Estimado usuario,\n\nEl sistema ha detectado que el viaje con ID ${tripID} fue solicitado por el cliente, sin embargo, aún no tiene un transportista asignado ni se ha completado su creación.\n\nPor favor, le solicitamos que atienda esta solicitud a la brevedad para evitar una congestión logística.\n\nSaludos,\nEquipo de Phortia`,
    }),
    "outOfDate": (tripID) => ({
        subject: `URGENTE: Riesgo de entrada tardía ${tripID}`,
        message: `Estimado usuario,\n\nEl viaje con ID <strong>${tripID}</strong> presenta un retraso crítico. Basado en el tiempo de traslado estimado y su estado actual, el sistema proyecta que la carga <strong>NO<strong> llegará a tiempo para cumplir con la ventana de entrega pactada con el cliente.\n\nSe requiere intervención y escalamiento inmediato con el transportista.\n\nSaludos, Equipo de Phortia`,
    }),
    "Delayed": (tripID) => ({
        subject: `ALERTA: Retraso en recolección de carga del viaje ${tripID}`,
        message: `Estimado usuario,\n\nEl viaje con ID ${tripID} presenta una demora en el origen. La hora programada para la recolección ya ha vencido, y el estatus del viaje aún no ha sido actualizado a 'En Tránsito'.\n\nPor favor, contacte al transportista asignado para verificar la ubicación de la unidad.\n\nSaludos, Equipo de Phortia`,
    }),
    "default": (tripID, warning) => ({
        subject: `ALERTA: Problema logístico detectado (${warning}) en viaje ${tripID}`,
        message: `Estimado usuario,\n\nEl sistema ha detectado una advertencia de tipo ${warning} para el viaje con ID ${tripID}.\n\nLe solicitamos que revise inmediatamente el panel de control para mayor información.\n\nSaludos, Equipo de Phortia`,
    }),
}