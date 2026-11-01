function staffProfile(body){
 const {firstName,lastName,email,phone,role,propertyId,voiceAccess,whatsappAccess}=body||{};
 if(typeof firstName!=='string'||!firstName.trim()||firstName.length>50||typeof lastName!=='string'||!lastName.trim()||lastName.length>50)throw Error('Enter first and last names (up to 50 characters each).');
 if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw Error('Enter a valid official email.');
 if(typeof phone!=='string'||!/^\+?[0-9 ()-]{8,22}$/.test(phone)||phone.replace(/\D/g,'').length<8||phone.replace(/\D/g,'').length>15)throw Error('Enter a valid mobile number with country code.');
 if(!require('./owner-routes').roles.includes(role)||!Number.isSafeInteger(Number(propertyId))||Number(propertyId)<1)throw Error('Choose a valid role and branch.');
 if(typeof voiceAccess!=='boolean'||typeof whatsappAccess!=='boolean')throw Error('Choose channel access.');
 return {firstName:firstName.trim(),lastName:lastName.trim(),name:firstName.trim()+' '+lastName.trim(),email:email.trim().toLowerCase(),phone:phone.trim(),role,propertyId:Number(propertyId),voiceAccess,whatsappAccess};
}
module.exports={staffProfile};
