import { GO_SERVER_BASE_URL, RECIPIENT_MOCKUP } from '../config.mjs';

export async function sendWarningEmail(bearerToken, warning, tripID) {
    const url =  + GO_SERVER_BASE_URL + '/api/alerts/email';

    const emailData = WarningEmailFactory[warning] || WarningEmailFactory["default"];
    const { subject, message } = emailData(tripID, warning);

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

    if (body.ok) {
        console.log('Email successfully sent!!');
    }
}

const WarningEmailFactory = {
    "Request no atendida": (tripID) => ({
        subject: `ALERTA: Solicitud de viaje sin asignar ${tripID}`,
        message: `Estimado usuario,\n\nEl sistema ha detectado que el
        viaje con ID ${tripID} fue solicitado por el cliente, sin embargo, aún no tiene un
        transportista asignado ni se ha completado su creación.\n\n
        Por favor, le solicitamos que atienda esta solicitud a la brevedad para evitar una
        congestión logística.\n\nSaludos,\nEquipo de Phortia`
    }),
    "outOfDate": (tripID) => ({
        subject: `URGENTE: Riesgo de entrada tardía ${tripID}`,
        message: `Estimado usuario,\n\nEl viaje con ID <strong>${tripID}</strong> presenta un retraso crítico.
        Basado en el tiempo de traslado estimado y su estado actual, el sistema proyecta que la carga
        <strong>NO<strong> llegará a tiempo para cumplir con la ventana de entrega pactada con el cliente.\n\n
        Se requiere intervención y escalamiento inmediato con el transportista.\n\nSaludos, Equipo de Phortia`
    }),
    "Delayed": (tripID) => ({
        subject: `ALERTA: Retraso en recolección de carga del viaje ${tripID}`,
        message: `Estimado usuario,\n\nEl viaje con ID ${tripID} presenta una demora en el origen. La hora
        programada para la recolección ya ha vencido, y el estatus del viaje aún no ha sido actualizado a "En Tránsito".\n\n
        Por favor, contacte al transportista asignado para verificar la ubicación de la unidad.\n\nSaludos, Equipo de Phortia`
    }),
    "default": (tripID, warning) => ({
        subject: `ALERTA: Problema logístico detectado (${warning}) en viaje ${tripID}`,
        message: `Estimado usuario,\n\nEl sistema ha detectado una advertencia de tipo ${warning} para el viaje con ID
        ${tripID}.\n\nLe solicitamos que revise inmediatamente el panel de control para mayor información.\n\nSaludos, Equipo de Phortia`
    })
}